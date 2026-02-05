import * as core from '@actions/core';
import * as github from '@actions/github';
import fs from 'node:fs/promises';
import path from 'node:path';
import { listGithubModels } from './lib/github-models.js';
import { redactSecrets, shouldSkipFileByPath } from './lib/redact.js';
import { runCouncil } from './council/pipeline-v2.js';
import { labelsForIssues } from './council/labels.js';
import { issuesToInlineComments } from './council/pr-comments.js';
function shouldReviewFile(f) {
    const lower = f.filename.toLowerCase();
    if (shouldSkipFileByPath(lower))
        return false;
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
function parseBool(s, def = false) {
    if (s == null || s === '')
        return def;
    return ['1', 'true', 'yes', 'on'].includes(String(s).toLowerCase());
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
function parseModelSpec(s, defaultProvider) {
    const raw = String(s || '').trim();
    const m = raw.match(/^([a-zA-Z0-9\-]+)\s*:\s*(.+)$/);
    if (m) {
        return { provider: m[1], model: m[2].trim() };
    }
    return { provider: defaultProvider, model: raw };
}
async function main() {
    const ghToken = core.getInput('github_token') || process.env.GITHUB_TOKEN;
    if (!ghToken)
        throw new Error('GitHub token is missing (github_token input / GITHUB_TOKEN env)');
    const defaultProvider = core.getInput('llm_provider') || 'github-models';
    const openaiApiKey = core.getInput('openai_api_key') || process.env.OPENAI_API_KEY;
    const googleApiKey = core.getInput('google_api_key') || process.env.GOOGLE_API_KEY;
    const reviewModelsRaw = parseCsvList(core.getInput('review_models'));
    const judgeModelRaw = core.getInput('judge_model') || 'gpt-4o';
    const verifierModelRaw = core.getInput('verifier_model') || 'gpt-4o-mini';
    const verifier2ModelRaw = core.getInput('verifier2_model');
    const criticModelRaw = core.getInput('critic_model');
    const maxFiles = Number(core.getInput('max_files') || '25');
    const maxPatchChars = Number(core.getInput('max_patch_chars') || '6000');
    const maxTotalChars = Number(core.getInput('max_total_chars') || '120000');
    const minConfidence = Number(core.getInput('min_confidence') || '0.6');
    const outputDir = core.getInput('output_dir') || 'llm-council-tool-out';
    const writeFiles = (core.getInput('write_files') || 'true').toLowerCase() !== 'false';
    const addLabels = parseBool(core.getInput('add_labels'), true);
    const addInline = parseBool(core.getInput('add_inline_comments'), false);
    const ctx = github.context;
    if (ctx.eventName !== 'pull_request' && ctx.eventName !== 'pull_request_target') {
        core.info(`Skipping: event ${ctx.eventName} not supported.`);
        return;
    }
    const pr = ctx.payload.pull_request;
    if (!pr)
        throw new Error('No pull_request in context payload');
    const prNumber = pr.number;
    const headSha = pr.head?.sha;
    const { owner, repo } = ctx.repo;
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
    // Build bounded diff payload (with redaction)
    const parts = [];
    let total = 0;
    let truncated = false;
    const redactionKinds = new Set();
    for (const f of selected) {
        const patchRaw = (f.patch || '').slice(0, maxPatchChars);
        const red = redactSecrets(patchRaw);
        red.redactions.forEach((x) => redactionKinds.add(x));
        const block = `FILE: ${f.filename}\n` +
            `STATUS: ${f.status}\n` +
            `CHANGES: +${f.additions}/-${f.deletions}\n` +
            `PATCH:\n${red.text || '[no patch provided by GitHub]'}\n`;
        if (total + block.length > maxTotalChars) {
            truncated = true;
            break;
        }
        parts.push(block);
        total += block.length;
    }
    const diffText = parts.join('\n---\n');
    // Resolve GitHub Models names (best-effort)
    const resolveForGithubModels = async (names) => {
        const available = await listGithubModels(ghToken);
        const nameMap = new Map();
        for (const m of available) {
            const n = String(m.name || '').trim();
            if (n)
                nameMap.set(n.toLowerCase(), n);
        }
        return names.map((n) => nameMap.get(String(n).toLowerCase()) ?? n);
    };
    const reviewersSpecs = [];
    const reviewerItems = reviewModelsRaw.length ? reviewModelsRaw : ['gpt-4o', 'Meta-Llama-3.1-405B-Instruct', 'gpt-4o-mini'];
    let reviewerModelsResolved = reviewerItems;
    if (defaultProvider === 'github-models')
        reviewerModelsResolved = await resolveForGithubModels(reviewerModelsResolved);
    for (const r of reviewerModelsResolved)
        reviewersSpecs.push(parseModelSpec(r, defaultProvider));
    let judgeSpec = parseModelSpec(judgeModelRaw, defaultProvider);
    let verifierSpec = parseModelSpec(verifierModelRaw, defaultProvider);
    let verifier2Spec = verifier2ModelRaw ? parseModelSpec(verifier2ModelRaw, defaultProvider) : undefined;
    let criticSpec = criticModelRaw ? parseModelSpec(criticModelRaw, defaultProvider) : undefined;
    if (defaultProvider === 'github-models') {
        // If user provided bare model names, canonicalize them too.
        const [j2] = await resolveForGithubModels([judgeSpec.model]);
        judgeSpec = { ...judgeSpec, model: j2 };
        const [v2] = await resolveForGithubModels([verifierSpec.model]);
        verifierSpec = { ...verifierSpec, model: v2 };
        if (verifier2Spec) {
            const [vv] = await resolveForGithubModels([verifier2Spec.model]);
            verifier2Spec = { ...verifier2Spec, model: vv };
        }
        if (criticSpec) {
            const [cc] = await resolveForGithubModels([criticSpec.model]);
            criticSpec = { ...criticSpec, model: cc };
        }
    }
    const { final, markdown, usage } = await runCouncil({
        githubToken: ghToken,
        openaiApiKey,
        googleApiKey,
        reviewers: reviewersSpecs.slice(0, 3),
        judge: judgeSpec,
        verifier: verifierSpec,
        verifier2: verifier2Spec,
        critic: criticSpec,
        minConfidence,
        diffText,
        truncatedDiff: truncated,
    });
    // Post / update PR comment
    const marker = '<!-- llm-council-tool -->';
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
            body: markdown,
        });
        core.info('Updated existing PR review comment.');
    }
    else {
        await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
            owner,
            repo,
            issue_number: prNumber,
            body: markdown,
        });
        core.info('Posted PR review comment.');
    }
    // Optional: apply labels
    if (addLabels) {
        const labels = labelsForIssues(final.issues.confirmed);
        if (labels.length) {
            try {
                await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', {
                    owner,
                    repo,
                    issue_number: prNumber,
                    labels,
                });
                core.info(`Applied labels: ${labels.join(', ')}`);
            }
            catch (e) {
                core.warning(`Failed to apply labels: ${String(e?.message ?? e)}`);
            }
        }
    }
    // Optional: inline PR review comments
    if (addInline && headSha) {
        const inline = issuesToInlineComments(final.issues.confirmed).slice(0, 10);
        for (const c of inline) {
            try {
                await octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/comments', {
                    owner,
                    repo,
                    pull_number: prNumber,
                    commit_id: headSha,
                    path: c.path,
                    side: 'RIGHT',
                    line: c.line,
                    body: c.body,
                });
            }
            catch (e) {
                core.warning(`Inline comment failed (${c.path}:${c.line}): ${String(e?.message ?? e)}`);
            }
        }
    }
    // Outputs + summary
    core.setOutput('review_markdown', markdown);
    core.setOutput('selected_files', String(parts.length));
    core.setOutput('selected_filenames', JSON.stringify(selected.slice(0, parts.length).map((f) => f.filename)));
    await core.summary
        .addHeading('LLM Council Tool')
        .addRaw(`Reviewed files: ${parts.length}\n\nConfirmed: ${final.summary.confirmedCount}\nUncertain: ${final.summary.uncertainCount}\n`)
        .write();
    // Artifacts
    const meta = {
        ...final,
        repo: { owner, repo },
        prNumber,
        budgets: { maxFiles, maxPatchChars, maxTotalChars },
        redactions: [...redactionKinds],
    };
    if (writeFiles) {
        await writeOutputs({
            outputDir,
            reviewMarkdown: markdown,
            diffText,
            meta,
            blobs: [
                { relPath: 'final.json', content: JSON.stringify(final, null, 2) },
                { relPath: 'usage.json', content: JSON.stringify(usage, null, 2) },
            ],
        });
    }
}
(async () => {
    try {
        await runWithRetries(main);
    }
    catch (err) {
        core.setFailed(String(err?.stack ?? err?.message ?? err));
    }
})();
