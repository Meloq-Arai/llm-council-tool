import * as core from '@actions/core';

import { extractFirstJsonObject } from './json.js';
import { FINAL_SCHEMA_VERSION, type FinalOutput, type FinalIssue } from './schema.js';
import { renderMarkdown } from './render.js';

import type { LLMProvider, LLMResult } from '../lib/llm.js';
import { callLLM } from '../lib/llm.js';

export type ModelSpec = { provider: LLMProvider; model: string };

export type CouncilConfig = {
  // auth
  githubToken?: string;
  openaiApiKey?: string;
  googleApiKey?: string;

  // models
  reviewers: ModelSpec[]; // candidates (we will try to run up to 3)
  judge: ModelSpec;
  verifier: ModelSpec;
  verifier2?: ModelSpec;
  critic?: ModelSpec;
  finalizer?: ModelSpec;

  minConfidence: number;

  diffText: string;
  truncatedDiff: boolean;
};

function clamp01(n: any): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function safeArray(x: any): any[] {
  return Array.isArray(x) ? x : [];
}

function normalizeIssue(x: any, idx: number): FinalIssue {
  return {
    issue_id: String(x.issue_id || x.id || `I${idx + 1}`),
    title: String(x.title || 'Untitled'),
    severity: (['critical', 'high', 'medium', 'low'].includes(String(x.severity))
      ? String(x.severity)
      : 'medium') as any,
    category: String(x.category || 'general'),
    file: String(x.file || (Array.isArray(x.files) ? x.files[0] : '') || ''),
    line_range:
      x.line_range && typeof x.line_range === 'object'
        ? {
            start: Number(x.line_range.start ?? x.line_range.from ?? 0) || 0,
            end: Number(x.line_range.end ?? x.line_range.to ?? x.line_range.start ?? 0) || 0,
            side: x.line_range.side === 'LEFT' ? 'LEFT' : 'RIGHT',
          }
        : undefined,
    why_this_matters: String(x.why_this_matters || x.why || ''),
    description: String(x.description || ''),
    evidence: String(x.evidence || ''),
    suggestion: String(x.suggestion || ''),
    confidence: clamp01(x.confidence),
    risk: clamp01(x.risk),
    fix_effort: (['xs', 's', 'm', 'l'].includes(String(x.fix_effort)) ? String(x.fix_effort) : 'm') as any,
    tags: safeArray(x.tags).map((t) => String(t)).slice(0, 20),
  };
}

async function callStage(cfg: CouncilConfig, label: string, spec: ModelSpec, messages: any[]): Promise<LLMResult> {
  const r = await callLLM({
    provider: spec.provider,
    model: spec.model,
    messages,
    githubToken: cfg.githubToken,
    openaiApiKey: cfg.openaiApiKey,
    googleApiKey: cfg.googleApiKey,
    timeoutMs: 240_000,
    maxRetries: 3,
  });
  return r;
}

export async function runCouncil(cfg: CouncilConfig): Promise<{ final: FinalOutput; markdown: string; usage: any }> {
  const usage: Record<string, any> = {};

  const reviewerSystem =
    `You are a top-tier senior software engineer doing PR review.\n` +
    `Find high-signal problems (correctness, security, edge cases, maintainability).\n` +
    `You MUST quote exact evidence from the diff for every issue.\n\n` +
    `Output JSON ONLY (no markdown, no code fences).\n` +
    `Schema: {"schemaVersion":1,"issues":[{"issue_id":string,"title":string,"severity":"critical"|"high"|"medium"|"low","category":string,"file":string,"line_range":{"start":number,"end":number,"side":"RIGHT"|"LEFT"},"why_this_matters":string,"description":string,"evidence":string,"suggestion":string,"risk":number,"fix_effort":"xs"|"s"|"m"|"l"}]}`;

  const capText = (text: string, maxChars: number) => (text.length > maxChars ? text.slice(0, maxChars) + `\n\n[TRUNCATED to ${maxChars} chars]` : text);

  const stageDiffFor = (spec: ModelSpec) => {
    // Be conservative for GitHub Models to avoid tokens_limit_reached.
    const max = spec.provider === 'github-models' ? 20_000 : 80_000;
    return capText(cfg.diffText, max);
  };

  const reviewerUser = (spec: ModelSpec) => `Diff:\n\n${stageDiffFor(spec)}`;

  const reviewerOutputs: Array<{ model: string; text: string; json: any | null }> = [];

  const usedReviewers: ModelSpec[] = [];
  const isUnknownModel = (e: any) =>
    /unknown_model/i.test(String(e?.message ?? e ?? '')) ||
    /"code"\s*:\s*"unknown_model"/i.test(String(e?.message ?? ''));

  for (let i = 0; i < cfg.reviewers.length; i++) {
    if (usedReviewers.length >= 3) break;

    const spec = cfg.reviewers[i];
    const label = `reviewer_${usedReviewers.length + 1}_${spec.provider}:${spec.model}`;

    try {
      const r = await callStage(cfg, label, spec, [
        { role: 'system', content: reviewerSystem },
        { role: 'user', content: reviewerUser(spec) },
      ]);
      usage[label] = r.usage;
      reviewerOutputs.push({ model: `${spec.provider}:${spec.model}`, text: r.text, json: extractFirstJsonObject(r.text) });
      usedReviewers.push(spec);
    } catch (e: any) {
      if (spec.provider === 'github-models' && isUnknownModel(e)) {
        core.warning(`Reviewer model rejected as unknown: ${spec.model} (skipping)`);
        continue;
      }
      throw e;
    }
  }

  if (usedReviewers.length < 2) {
    throw new Error(`Not enough reviewer models available (got ${usedReviewers.length}).`);
  }

  const judgeSystem =
    `You are the judge. Dedupe and consolidate reviewer issues.\n` +
    `Remove weak / unsupported / repetitive items.\n` +
    `Every issue MUST include exact evidence quoted from diff.\n\n` +
    `Output JSON ONLY. SchemaVersion=1. issues[].issue_id must be stable short ids (I1,I2,...).\n` +
    `Return up to 25 issues.`;

  const judgeUser =
    `Diff:\n\n${stageDiffFor(cfg.judge)}\n\n` +
    `Reviewer issues (trimmed):\n\n` +
    reviewerOutputs
      .map((o, idx) => {
        const issues = safeArray(o.json?.issues).slice(0, 20);
        const payload = issues.length ? JSON.stringify({ schemaVersion: 1, issues }, null, 2) : o.text.slice(0, 4000);
        return `REVIEWER_${idx + 1} (${o.model}):\n${payload}`;
      })
      .join('\n\n');

  const judgeLabel = `judge_${cfg.judge.provider}:${cfg.judge.model}`;
  const judgeRes = await callStage(cfg, judgeLabel, cfg.judge, [
    { role: 'system', content: judgeSystem },
    { role: 'user', content: judgeUser },
  ]);
  usage[judgeLabel] = judgeRes.usage;

  let judgeJson: any = extractFirstJsonObject(judgeRes.text);

  // optional critic self-check loop
  if (cfg.critic) {
    const criticSystem =
      `You are a strict critic. Validate each issue is supported by the diff.\n` +
      `Remove anything speculative. Tighten wording. Keep only high-signal items.\n\n` +
      `Output JSON ONLY with same schema.`;

    const criticUser = `Diff:\n\n${cfg.diffText}\n\nCurrent issues:\n\n${JSON.stringify(judgeJson, null, 2)}`;

    const criticLabel = `critic_${cfg.critic.provider}:${cfg.critic.model}`;
    const criticRes = await callStage(cfg, criticLabel, cfg.critic, [
      { role: 'system', content: criticSystem },
      { role: 'user', content: criticUser },
    ]);
    usage[criticLabel] = criticRes.usage;
    judgeJson = extractFirstJsonObject(criticRes.text) ?? judgeJson;
  }

  const judgeIssuesRaw = safeArray(judgeJson?.issues).slice(0, 25);
  const judgeIssues = judgeIssuesRaw.map(normalizeIssue);

  const verifierSystem =
    `You are a confidence checker. For each issue, verify it against the diff.\n` +
    `If not clearly supported, mark unconfirmed with low confidence.\n` +
    `You MUST quote evidence from the diff in your response.\n\n` +
    `Output JSON ONLY: {"schemaVersion":1,"results":[{"issue_id":string,"confirmed":boolean,"confidence":number,"note":string,"evidence":string}]}`;

  const verifierUser = `Diff:\n\n${stageDiffFor(cfg.verifier)}\n\nIssues:\n\n${JSON.stringify(judgeIssues, null, 2)}`;

  const verifyOnce = async (spec: ModelSpec, label: string) => {
    const res = await callStage(cfg, label, spec, [
      { role: 'system', content: verifierSystem },
      { role: 'user', content: verifierUser },
    ]);
    usage[label] = res.usage;
    const json = extractFirstJsonObject(res.text);
    return json;
  };

  const v1 = await verifyOnce(cfg.verifier, `verifier_${cfg.verifier.provider}:${cfg.verifier.model}`);
  const v2 = cfg.verifier2 ? await verifyOnce(cfg.verifier2, `verifier2_${cfg.verifier2.provider}:${cfg.verifier2.model}`) : null;

  const toMap = (vj: any) => {
    const m = new Map<string, { confirmed: boolean; confidence: number }>();
    for (const r of safeArray(vj?.results)) {
      const id = String(r.issue_id || r.id || '').trim();
      if (!id) continue;
      m.set(id, { confirmed: Boolean(r.confirmed), confidence: clamp01(r.confidence) });
    }
    return m;
  };

  const m1 = toMap(v1);
  const m2 = v2 ? toMap(v2) : null;

  const confirmed: FinalIssue[] = [];
  const uncertain: FinalIssue[] = [];

  for (const i of judgeIssues) {
    const a = m1.get(i.issue_id);
    const b = m2?.get(i.issue_id);

    const conf = a?.confidence ?? 0;
    const conf2 = b?.confidence;

    // combine: if verifier2 exists, require both to confirm OR one confirm with very high confidence.
    const combinedConfirmed =
      b
        ? (a?.confirmed && b?.confirmed && Math.min(conf, conf2 ?? 0) >= cfg.minConfidence) ||
          ((a?.confirmed || b?.confirmed) && Math.max(conf, conf2 ?? 0) >= Math.max(0.85, cfg.minConfidence))
        : Boolean(a?.confirmed) && conf >= cfg.minConfidence;

    const finalIssue: FinalIssue = {
      ...i,
      confidence: b ? Math.max(conf, conf2 ?? 0) : conf,
    };

    (combinedConfirmed ? confirmed : uncertain).push(finalIssue);
  }

  // optional finalizer: rewrite/shorten markdown (keeps JSON stable)
  const final: FinalOutput = {
    schemaVersion: FINAL_SCHEMA_VERSION,
    summary: {
      confirmedCount: confirmed.length,
      uncertainCount: uncertain.length,
      truncatedDiff: cfg.truncatedDiff,
    },
    issues: {
      confirmed,
      uncertain,
    },
    models: {
      reviewers: usedReviewers.map((s) => `${s.provider}:${s.model}`),
      judge: `${cfg.judge.provider}:${cfg.judge.model}`,
      verifier: `${cfg.verifier.provider}:${cfg.verifier.model}`,
      ...(cfg.verifier2 ? { verifier2: `${cfg.verifier2.provider}:${cfg.verifier2.model}` } : {}),
      ...(cfg.critic ? { critic: `${cfg.critic.provider}:${cfg.critic.model}` } : {}),
      ...(cfg.finalizer ? { finalizer: `${cfg.finalizer.provider}:${cfg.finalizer.model}` } : {}),
    },
    usage,
  };

  const markdown = renderMarkdown(final);

  return { final, markdown, usage };
}
