import * as core from '@actions/core';
import * as github from '@actions/github';
import fs from 'node:fs/promises';
import path from 'node:path';
import { callLLM } from './lib/llm.js';
import { listGithubModels } from './lib/github-models.js';
import { extractFirstJsonObject } from './council/json.js';
function shouldReviewFile(f) {
    const lower = f.filename.toLowerCase();
    // common junk
    if (lower.endsWith('.lock'))
        return false;
    if (lower.endsWith('package-lock.json'))
        return false;
    if (lower.endsWith('pnpm-lock.yaml'))
        return false;
    if (lower.endsWith('yarn.lock'))
        return false;
    // typical generated/vendor paths
    if (lower.includes('/dist/') || lower.includes('\\dist\\'))
        return false;
    if (lower.includes('/build/') || lower.includes('\\build\\'))
        return false;
    if (lower.includes('/vendor/') || lower.includes('\\vendor\\'))
        return false;
    // minified
    if (lower.endsWith('.min.js') || lower.endsWith('.min.css'))
        return false;
    // skip trivial
    if ((f.additions + f.deletions) < 10)
        return false;
    return true;
}
function parseCsvList(s) {
    return (s || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function isTransientError(err) {
    const msg = String(err?.message ?? err ?? '');
    return (/\b(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND)\b/i.test(msg) ||
        /\b(429|500|502|503|504)\b/.test(msg) ||
        /rate limit/i.test(msg) ||
        /timeout/i.test(msg));
}
async function runWithRetries(fn) {
    const maxAttempts = Number(process.env.LLM_COUNCIL_RETRIES ?? 3);
    let lastErr = undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await fn();
            return;
        }
        catch (err) {
            lastErr = err;
            if (!isTransientError(err) || attempt === maxAttempts) {
                throw err;
            }
            const backoffMs = Math.min(30_000, 1_000 * Math.pow(2, attempt - 1));
            core.warning(`Transient error (attempt ${attempt}/${maxAttempts}). Retrying in ${backoffMs}ms: ${String(err?.message ?? err)}`);
            await sleep(backoffMs);
        }
    }
    throw lastErr;
}
async function writeOutputs(params) {
    const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
    const outDirAbs = path.isAbsolute(params.outputDir)
        ? params.outputDir
        : path.join(workspace, params.outputDir);
    await fs.mkdir(outDirAbs, { recursive: true });
    const reviewPath = path.join(outDirAbs, 'review.md');
    const diffPath = path.join(outDirAbs, 'diff.txt');
    const metaPath = path.join(outDirAbs, 'meta.json');
    await Promise.all([
        fs.writeFile(reviewPath, params.reviewMarkdown, 'utf8'),
        fs.writeFile(diffPath, params.diffText, 'utf8'),
        fs.writeFile(metaPath, JSON.stringify(params.meta, null, 2), 'utf8'),
    ]);
    for (const b of params.blobs) {
        const pAbs = path.join(outDirAbs, b.relPath);
        await fs.mkdir(path.dirname(pAbs), { recursive: true });
        await fs.writeFile(pAbs, b.content, 'utf8');
    }
    core.setOutput('review_path', path.relative(workspace, reviewPath));
    core.setOutput('diff_path', path.relative(workspace, diffPath));
    core.setOutput('meta_path', path.relative(workspace, metaPath));
}
function toMarkdownIssue(i, v) {
    const conf = v ? ` (confidence ${(v.confidence * 100).toFixed(0)}%)` : '';
    const header = `- **${i.title}** — _${i.severity}/${i.category}_${conf}`;
    const lines = [header];
    if (i.files?.length)
        lines.push(`  - Files: ${i.files.join(', ')}`);
    if (i.description)
        lines.push(`  - ${i.description}`);
    if (v?.evidence || i.evidence)
        lines.push(`  - Evidence: ${v?.evidence ?? i.evidence}`);
    if (i.suggestion)
        lines.push(`  - Suggestion: ${i.suggestion}`);
    if (v?.note)
        lines.push(`  - Note: ${v.note}`);
    return lines.join('\n');
}
async function run() {
    const ghToken = core.getInput('github_token') || process.env.GITHUB_TOKEN;
    if (!ghToken)
        throw new Error('GitHub token is missing (github_token input / GITHUB_TOKEN env)');
    const provider = (core.getInput('llm_provider') || 'github-models');
    const openaiApiKey = core.getInput('openai_api_key') || process.env.OPENAI_API_KEY;
    const reviewModels = parseCsvList(core.getInput('review_models'));
    let judgeModel = core.getInput('judge_model') || 'gpt-4o';
    let verifierModel = core.getInput('verifier_model') || 'gpt-4o-mini';
    const maxFiles = Number(core.getInput('max_files') || '25');
    const maxPatchChars = Number(core.getInput('max_patch_chars') || '6000');
    const maxTotalChars = Number(core.getInput('max_total_chars') || '120000');
    const minConfidence = Number(core.getInput('min_confidence') || '0.55');
    const outputDir = core.getInput('output_dir') || '.llm-council-tool';
    const writeFiles = (core.getInput('write_files') || 'true').toLowerCase() !== 'false';
    const ctx = github.context;
    if (ctx.eventName !== 'pull_request' && ctx.eventName !== 'pull_request_target') {
        core.info(`Skipping: event ${ctx.eventName} not supported.`);
        return;
    }
    const pr = ctx.payload.pull_request;
    if (!pr)
        throw new Error('No pull_request in context payload');
    const { owner, repo } = ctx.repo;
    const prNumber = pr.number;
    const octokit = github.getOctokit(ghToken);
    // Fetch changed files (paginated)
    const files = [];
    let page = 1;
    while (true) {
        const res = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
            owner,
            repo,
            pull_number: prNumber,
            per_page: 100,
            page,
        });
        const batch = res.data;
        if (!batch.length)
            break;
        for (const f of batch)
            files.push(f);
        if (batch.length < 100)
            break;
        page++;
    }
    const selected = files.filter(shouldReviewFile).slice(0, maxFiles);
    if (!selected.length) {
        core.info('No files selected for review.');
        return;
    }
    // Build a bounded diff payload
    const parts = [];
    let total = 0;
    let truncated = false;
    for (const f of selected) {
        const patch = (f.patch || '').slice(0, maxPatchChars);
        const block = `FILE: ${f.filename}\n` +
            `STATUS: ${f.status}\n` +
            `CHANGES: +${f.additions}/-${f.deletions}\n` +
            `PATCH:\n${patch || '[no patch provided by GitHub]'}\n`;
        if (total + block.length > maxTotalChars) {
            truncated = true;
            break;
        }
        parts.push(block);
        total += block.length;
    }
    const diffText = parts.join('\n---\n');
    const llmAuth = {
        provider,
        githubToken: ghToken,
        openaiApiKey,
    };
    // Resolve GitHub Models names (available models differ by account/entitlement; names can be case-sensitive).
    let resolvedReviewModels = reviewModels;
    let resolvedJudgeModel = judgeModel;
    let resolvedVerifierModel = verifierModel;
    if (provider === 'github-models') {
        const available = await listGithubModels(ghToken);
        const nameMap = new Map();
        for (const m of available) {
            const n = String(m.name || '').trim();
            if (!n)
                continue;
            nameMap.set(n.toLowerCase(), n);
        }
        const canonicalize = (name) => {
            const key = String(name || '').trim().toLowerCase();
            return key ? (nameMap.get(key) ?? null) : null;
        };
        const fallbackPool = [
            'gpt-4o',
            'Meta-Llama-3.1-405B-Instruct',
            'Meta-Llama-3.1-70B-Instruct',
            'Meta-Llama-3-70B-Instruct',
            'AI21-Jamba-Instruct',
            'Mistral-large-2407',
            'gpt-4o-mini',
        ];
        const pick = (requested, count) => {
            const out = [];
            const seen = new Set();
            const add = (n) => {
                if (!n)
                    return;
                const k = n.toLowerCase();
                if (seen.has(k))
                    return;
                seen.add(k);
                out.push(n);
            };
            for (const r of requested)
                add(canonicalize(r));
            for (const f of fallbackPool)
                add(canonicalize(f));
            return out.slice(0, count);
        };
        resolvedReviewModels = pick(reviewModels, 3);
        resolvedJudgeModel = canonicalize(judgeModel) ?? pick([judgeModel], 1)[0] ?? 'gpt-4o';
        resolvedVerifierModel = canonicalize(verifierModel) ?? pick([verifierModel], 1)[0] ?? 'gpt-4o-mini';
        core.info(`Resolved GitHub Models: reviewers=[${resolvedReviewModels.join(', ')}], judge=${resolvedJudgeModel}, verifier=${resolvedVerifierModel}`);
    }
    const usage = {};
    async function call(model, messages, label) {
        const r = await callLLM({
            provider: llmAuth.provider,
            model,
            messages,
            openaiApiKey: llmAuth.openaiApiKey,
            githubToken: llmAuth.githubToken,
            timeoutMs: 240_000,
            maxRetries: 3,
        });
        usage[label] = r.usage;
        return r;
    }
    // 1) Reviewers
    const reviewerSystem = `You are a top-tier senior software engineer doing PR review.\n` +
        `Goal: find high-signal problems (correctness, security, edge cases, maintainability).\n\n` +
        `Output JSON ONLY (no markdown, no code fences).\n` +
        `Schema:\n` +
        `{\n` +
        `  "schemaVersion": 1,\n` +
        `  "issues": [\n` +
        `    {\n` +
        `      "title": string,\n` +
        `      "severity": "critical"|"high"|"medium"|"low",\n` +
        `      "category": string,\n` +
        `      "files": string[],\n` +
        `      "description": string,\n` +
        `      "evidence": string,\n` +
        `      "suggestion": string\n` +
        `    }\n` +
        `  ]\n` +
        `}`;
    const reviewerUser = `Review the following PR diffs. Quote evidence from the PATCH when possible.\n\n${diffText}`;
    const reviewerResults = [];
    const models3 = resolvedReviewModels.length
        ? resolvedReviewModels.slice(0, 3)
        : ['gpt-4o', 'Meta-Llama-3.1-405B-Instruct', 'gpt-4o-mini'];
    for (let i = 0; i < models3.length; i++) {
        const model = models3[i];
        const r = await call(model, [
            { role: 'system', content: reviewerSystem },
            { role: 'user', content: reviewerUser },
        ], `reviewer_${i + 1}_${model}`);
        const parsed = extractFirstJsonObject(r.text);
        reviewerResults.push({ model, rawText: r.text, parsed, usage: r.usage });
    }
    // 2) Judge (dedupe + synthesize)
    const judgeSystem = `You are the judge model. You receive 3 reviewer JSON outputs and the raw diff.\n` +
        `Task: deduplicate, remove repetition, fix obvious mistakes, and output a single consolidated list of issues.\n` +
        `Prefer fewer, higher-signal issues with strong evidence.\n\n` +
        `Output JSON ONLY (no markdown, no code fences).\n` +
        `Schema:\n` +
        `{\n` +
        `  "schemaVersion": 1,\n` +
        `  "issues": [\n` +
        `    {\n` +
        `      "id": string,\n` +
        `      "title": string,\n` +
        `      "severity": "critical"|"high"|"medium"|"low",\n` +
        `      "category": string,\n` +
        `      "files": string[],\n` +
        `      "description": string,\n` +
        `      "evidence": string,\n` +
        `      "suggestion": string\n` +
        `    }\n` +
        `  ]\n` +
        `}`;
    const judgeUser = `Diff:\n\n${diffText}\n\n` +
        `Reviewer outputs (may be imperfect):\n\n` +
        reviewerResults
            .map((rr, idx) => {
            const payload = rr.parsed ? JSON.stringify(rr.parsed) : rr.rawText;
            return `REVIEWER_${idx + 1} (${rr.model}):\n${payload}`;
        })
            .join('\n\n');
    const judgeRes = await call(resolvedJudgeModel, [
        { role: 'system', content: judgeSystem },
        { role: 'user', content: judgeUser },
    ], `judge_${resolvedJudgeModel}`);
    const judgeParsed = extractFirstJsonObject(judgeRes.text);
    const judgeIssues = Array.isArray(judgeParsed?.issues)
        ? judgeParsed.issues
            .map((x, idx) => ({
            id: String(x.id || `I${idx + 1}`),
            title: String(x.title || 'Untitled'),
            severity: (['critical', 'high', 'medium', 'low'].includes(String(x.severity))
                ? String(x.severity)
                : 'medium'),
            category: String(x.category || 'general'),
            files: Array.isArray(x.files) ? x.files.map((f) => String(f)) : [],
            description: String(x.description || ''),
            evidence: typeof x.evidence === 'string' ? x.evidence : undefined,
            suggestion: typeof x.suggestion === 'string' ? x.suggestion : undefined,
        }))
            .slice(0, 30)
        : [];
    // 3) Confidence checker
    const verifierSystem = `You are a strict confidence checker. You must verify each proposed issue against the diff.\n` +
        `If the diff does NOT support an issue, mark it unconfirmed with low confidence.\n\n` +
        `Output JSON ONLY (no markdown, no code fences).\n` +
        `Schema:\n` +
        `{\n` +
        `  "schemaVersion": 1,\n` +
        `  "results": [\n` +
        `    { "id": string, "confirmed": boolean, "confidence": number, "note": string, "evidence": string }\n` +
        `  ]\n` +
        `}`;
    const verifierUser = `Diff:\n\n${diffText}\n\n` +
        `Issues to verify:\n\n` +
        JSON.stringify(judgeIssues.map((i) => ({
            id: i.id,
            title: i.title,
            severity: i.severity,
            category: i.category,
            files: i.files,
            description: i.description,
            evidence: i.evidence,
            suggestion: i.suggestion,
        })), null, 2);
    const verifierRes = await call(resolvedVerifierModel, [
        { role: 'system', content: verifierSystem },
        { role: 'user', content: verifierUser },
    ], `verifier_${resolvedVerifierModel}`);
    const verifierParsed = extractFirstJsonObject(verifierRes.text);
    const verifierMap = new Map();
    if (Array.isArray(verifierParsed?.results)) {
        for (const r of verifierParsed.results) {
            const id = String(r.id ?? '').trim();
            if (!id)
                continue;
            const confidence = Math.max(0, Math.min(1, Number(r.confidence ?? 0)));
            verifierMap.set(id, {
                confirmed: Boolean(r.confirmed),
                confidence,
                note: typeof r.note === 'string' ? r.note : undefined,
                evidence: typeof r.evidence === 'string' ? r.evidence : undefined,
            });
        }
    }
    const confirmed = [];
    const uncertain = [];
    for (const i of judgeIssues) {
        const v = verifierMap.get(i.id);
        const c = v?.confidence ?? 0;
        const ok = Boolean(v?.confirmed) && c >= minConfidence;
        (ok ? confirmed : uncertain).push(i);
    }
    const marker = '<!-- llm-council-tool -->';
    const modelsLine = `Reviewers: ${models3.join(', ')} · Judge: ${resolvedJudgeModel} · Verifier: ${resolvedVerifierModel}`;
    const mdLines = [];
    mdLines.push(marker);
    mdLines.push('## 🤖 LLM Council Review');
    mdLines.push('');
    mdLines.push(modelsLine);
    mdLines.push('');
    mdLines.push(`Selected files: ${parts.length}${truncated ? ` (diff truncated to fit max_total_chars=${maxTotalChars})` : ''}`);
    mdLines.push('');
    mdLines.push('### Summary');
    mdLines.push('');
    mdLines.push(`Confirmed issues: **${confirmed.length}** · Uncertain: **${uncertain.length}**`);
    mdLines.push('');
    mdLines.push('### Confirmed issues');
    mdLines.push('');
    if (!confirmed.length)
        mdLines.push('- (none)');
    for (const i of confirmed) {
        mdLines.push(toMarkdownIssue(i, verifierMap.get(i.id)));
    }
    mdLines.push('');
    mdLines.push('### Uncertain / needs human check');
    mdLines.push('');
    if (!uncertain.length)
        mdLines.push('- (none)');
    for (const i of uncertain) {
        mdLines.push(toMarkdownIssue(i, verifierMap.get(i.id)));
    }
    mdLines.push('');
    const usageJson = JSON.stringify(usage, null, 2);
    mdLines.push('<details>');
    mdLines.push('<summary>Usage (tokens)</summary>');
    mdLines.push('');
    mdLines.push('```json');
    mdLines.push(usageJson);
    mdLines.push('```');
    mdLines.push('</details>');
    const reviewMarkdown = mdLines.join('\n');
    // Update existing comment (no spam)
    const comments = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner,
        repo,
        issue_number: prNumber,
        per_page: 100,
    });
    const existing = comments.data.find((c) => typeof c?.body === 'string' && c.body.includes(marker));
    if (existing?.id) {
        await octokit.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
            owner,
            repo,
            comment_id: existing.id,
            body: reviewMarkdown,
        });
        core.info('Updated existing PR review comment.');
    }
    else {
        await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
            owner,
            repo,
            issue_number: prNumber,
            body: reviewMarkdown,
        });
        core.info('Posted PR review comment.');
    }
    core.setOutput('review_markdown', reviewMarkdown);
    core.setOutput('selected_files', String(parts.length));
    core.setOutput('selected_filenames', JSON.stringify(selected.slice(0, parts.length).map((f) => f.filename)));
    const meta = {
        schemaVersion: 2,
        provider,
        repo: { owner, repo },
        prNumber,
        models: {
            reviewers: models3,
            judge: resolvedJudgeModel,
            verifier: resolvedVerifierModel,
        },
        budgets: { maxFiles, maxPatchChars, maxTotalChars },
        minConfidence,
        selectedFiles: selected.slice(0, parts.length).map((f) => ({
            filename: f.filename,
            additions: f.additions,
            deletions: f.deletions,
            status: f.status,
        })),
        truncated,
        usage,
        createdAt: new Date().toISOString(),
    };
    if (writeFiles) {
        const blobs = [];
        for (let i = 0; i < reviewerResults.length; i++) {
            const rr = reviewerResults[i];
            blobs.push({
                relPath: `reviewers/reviewer-${i + 1}-${rr.model}.txt`,
                content: rr.rawText,
            });
            if (rr.parsed) {
                blobs.push({
                    relPath: `reviewers/reviewer-${i + 1}-${rr.model}.json`,
                    content: JSON.stringify(rr.parsed, null, 2),
                });
            }
        }
        blobs.push({ relPath: 'judge.txt', content: judgeRes.text });
        if (judgeParsed)
            blobs.push({ relPath: 'judge.json', content: JSON.stringify(judgeParsed, null, 2) });
        blobs.push({ relPath: 'verifier.txt', content: verifierRes.text });
        if (verifierParsed)
            blobs.push({ relPath: 'verifier.json', content: JSON.stringify(verifierParsed, null, 2) });
        await writeOutputs({
            outputDir,
            reviewMarkdown,
            diffText,
            meta,
            blobs,
        });
    }
    await core.summary
        .addHeading('LLM Council Tool')
        .addRaw(`Provider: ${provider}\n\n${modelsLine}\n\nReviewed files: ${parts.length}\n`)
        .addRaw(writeFiles ? `\nWrote outputs to: ${outputDir}\n` : '')
        .write();
}
(async () => {
    try {
        await runWithRetries(run);
    }
    catch (err) {
        core.setFailed(String(err?.stack ?? err?.message ?? err));
    }
})();
