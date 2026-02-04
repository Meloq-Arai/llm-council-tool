import * as core from '@actions/core';
import * as github from '@actions/github';

import { callOpenAI } from './lib/openai.js';

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

  // common junk
  if (lower.endsWith('.lock')) return false;
  if (lower.endsWith('package-lock.json')) return false;
  if (lower.endsWith('pnpm-lock.yaml')) return false;
  if (lower.endsWith('yarn.lock')) return false;

  // typical generated/vendor paths
  if (lower.includes('/dist/') || lower.includes('\\dist\\')) return false;
  if (lower.includes('/build/') || lower.includes('\\build\\')) return false;
  if (lower.includes('/vendor/') || lower.includes('\\vendor\\')) return false;

  // minified
  if (lower.endsWith('.min.js') || lower.endsWith('.min.css')) return false;

  // skip trivial
  if ((f.additions + f.deletions) < 10) return false;

  return true;
}

async function main() {
  try {
    const ghToken = core.getInput('github_token') || process.env.GITHUB_TOKEN;
    if (!ghToken) throw new Error('GitHub token is missing (github_token input / GITHUB_TOKEN env)');

    const openaiApiKey = core.getInput('openai_api_key', { required: true });
    const openaiModel = core.getInput('openai_model') || 'gpt-4.1-mini';

    const maxFiles = Number(core.getInput('max_files') || '25');
    const maxPatchChars = Number(core.getInput('max_patch_chars') || '6000');
    const maxTotalChars = Number(core.getInput('max_total_chars') || '120000');

    const ctx = github.context;
    if (ctx.eventName !== 'pull_request' && ctx.eventName !== 'pull_request_target') {
      core.info(`Skipping: event ${ctx.eventName} not supported.`);
      return;
    }

    const pr = (ctx.payload as any).pull_request;
    if (!pr) throw new Error('No pull_request in context payload');

    const { owner, repo } = ctx.repo;
    const prNumber: number = pr.number;

    const octokit = github.getOctokit(ghToken);

    // Fetch changed files (paginated)
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

    // Build a bounded diff payload
    const parts: string[] = [];
    let total = 0;

    for (const f of selected) {
      const patch = (f.patch || '').slice(0, maxPatchChars);
      const block =
        `FILE: ${f.filename}\n` +
        `STATUS: ${f.status}\n` +
        `CHANGES: +${f.additions}/-${f.deletions}\n` +
        `PATCH:\n${patch || '[no patch provided by GitHub]'}\n`;

      if (total + block.length > maxTotalChars) break;
      parts.push(block);
      total += block.length;
    }

    const patches = parts.join('\n---\n');

    const prompt =
      `You are a senior code reviewer. Review the following GitHub PR diffs.\n\n` +
      `Rules:\n` +
      `- Be concise and specific.\n` +
      `- Prefer high-signal issues: correctness, security, edge cases, maintainability.\n` +
      `- If you suggest a change, show a short code snippet.\n` +
      `- Output Markdown with sections: Summary, High-risk issues, Suggestions, Questions.\n\n` +
      `Diffs:\n\n${patches}`;

    const { text: outputText, usage } = await callOpenAI({
      apiKey: openaiApiKey,
      model: openaiModel,
      prompt,
      timeoutMs: 240_000,
      maxRetries: 3,
    });

    const marker = '<!-- llm-council-tool -->';
    const usageLine = usage?.totalTokens
      ? `Tokens: input ${usage.inputTokens ?? '?'} · output ${usage.outputTokens ?? '?'} · total ${usage.totalTokens}`
      : undefined;

    const body =
      `${marker}\n` +
      `## 🤖 LLM Review (MVP)\n\n` +
      `Model: \`${openaiModel}\`\n\n` +
      `${usageLine ? usageLine + '\n\n' : ''}` +
      outputText;

    // Update existing comment (no spam)
    const comments = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
    });

    const existing = (comments.data as any[]).find((c) => typeof c?.body === 'string' && c.body.includes(marker));

    if (existing?.id) {
      await octokit.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
        owner,
        repo,
        comment_id: existing.id,
        body,
      });
      core.info('Updated existing PR review comment.');
    } else {
      await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner,
        repo,
        issue_number: prNumber,
        body,
      });
      core.info('Posted PR review comment.');
    }

    core.setOutput('review_markdown', body);
    core.setOutput('selected_files', String(parts.length));

    await core.summary
      .addHeading('LLM Council Tool')
      .addRaw(`Reviewed files: ${parts.length}\n\nModel: ${openaiModel}\n`)
      .write();
  } catch (err: any) {
    core.setFailed(err?.message || String(err));
  }
}

await main();
