import * as core from '@actions/core';
import * as github from '@actions/github';
import { Octokit } from 'octokit';

type PRFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
};

function shouldReviewFile(f: PRFile): boolean {
  const lower = f.filename.toLowerCase();
  if (lower.endsWith('.lock')) return false;
  if (lower.includes('package-lock.json')) return false;
  if (lower.includes('pnpm-lock.yaml')) return false;
  if (lower.includes('yarn.lock')) return false;

  // skip trivial
  if ((f.additions + f.deletions) < 10) return false;

  return true;
}

async function main() {
  try {
    const openaiApiKey = core.getInput('openai_api_key', { required: true });
    const openaiModel = core.getInput('openai_model') || 'gpt-4.1-mini';
    const maxFiles = Number(core.getInput('max_files') || '25');
    const maxPatchChars = Number(core.getInput('max_patch_chars') || '6000');

    const ctx = github.context;
    if (ctx.eventName !== 'pull_request' && ctx.eventName !== 'pull_request_target') {
      core.info(`Skipping: event ${ctx.eventName} not supported.`);
      return;
    }

    const pr = (ctx.payload as any).pull_request;
    if (!pr) throw new Error('No pull_request in context payload');

    const { owner, repo } = ctx.repo;
    const prNumber: number = pr.number;

    const ghToken = process.env.GITHUB_TOKEN;
    if (!ghToken) throw new Error('GITHUB_TOKEN is missing');

    const octokit = new Octokit({ auth: ghToken });

    // Fetch changed files
    const files: PRFile[] = [];
    let page = 1;
    while (true) {
      const res = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
        page,
      });
      const batch = res.data as any[];
      if (!batch.length) break;
      for (const f of batch) files.push(f);
      if (batch.length < 100) break;
      page++;
    }

    const selected = files.filter(shouldReviewFile).slice(0, maxFiles);

    if (!selected.length) {
      core.info('No files selected for review.');
      return;
    }

    // Build a compact prompt (MVP: one comment, not inline suggestions)
    const patches = selected.map((f) => {
      const patch = (f.patch || '').slice(0, maxPatchChars);
      return `FILE: ${f.filename}\nSTATUS: ${f.status}\nCHANGES: +${f.additions}/-${f.deletions}\nPATCH:\n${patch || '[no patch provided by GitHub]'}\n`;
    }).join('\n---\n');

    const prompt = `You are a senior code reviewer. Review the following GitHub PR diffs.

Rules:
- Be concise and specific.
- Prefer high-signal issues: correctness, security, edge cases, maintainability.
- If you suggest a change, show a short code snippet.
- Output Markdown.

Diffs:\n\n${patches}`;

    // Call OpenAI (MVP: direct HTTPS fetch to Responses API)
    // NOTE: We keep it simple and avoid extra deps.
    const resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: openaiModel,
        input: prompt,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OpenAI API error: ${resp.status} ${resp.statusText}\n${text}`);
    }

    const data: any = await resp.json();
    const outputText: string =
      data.output_text ||
      data.output?.map((o: any) => o?.content?.map((c: any) => c?.text)?.join('') ).join('\n') ||
      JSON.stringify(data, null, 2);

    const body = `## 🤖 LLM Review (MVP)\n\nModel: \`${openaiModel}\`\n\n${outputText}`;

    await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
      owner,
      repo,
      issue_number: prNumber,
      body,
    });

    core.info('Posted PR review comment.');
  } catch (err: any) {
    core.setFailed(err?.message || String(err));
  }
}

await main();
