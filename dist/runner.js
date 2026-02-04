import fs from 'node:fs';
import path from 'node:path';
import { getGitDiff } from './lib/diff.js';
import { packUnifiedDiffForPrompt } from './lib/diff-pack.js';
import { buildReviewPrompt } from './lib/prompt.js';
import { callOpenAI } from './lib/openai.js';
function getArg(name) {
    const idx = process.argv.indexOf(`--${name}`);
    if (idx === -1)
        return undefined;
    return process.argv[idx + 1];
}
async function main() {
    const repoPath = getArg('repo') || process.cwd();
    const base = getArg('base') || 'origin/main';
    const head = getArg('head') || 'HEAD';
    const model = getArg('model') || process.env.OPENAI_MODEL || 'gpt-5.2';
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.error('Missing OPENAI_API_KEY env var');
        process.exit(2);
    }
    const diff = getGitDiff({ cwd: repoPath, baseRef: base, headRef: head, maxChars: 200_000 });
    if (!diff.trim()) {
        console.log('No diff.');
        return;
    }
    const packed = packUnifiedDiffForPrompt(diff, {
        maxFiles: 25,
        maxCharsPerFile: 6000,
        maxTotalChars: 120_000,
    });
    const diffForPrompt = packed.text || diff.slice(0, 120_000);
    const prompt = buildReviewPrompt(diffForPrompt, {
        repoName: repoPath,
        instructions: packed.truncated ? 'Note: diff was truncated to fit a safe budget.' : undefined,
    });
    const { text: out } = await callOpenAI({ apiKey, model, prompt, timeoutMs: 180_000 });
    const outDir = getArg('out') || path.resolve(process.cwd(), 'out');
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(outDir, `review-${stamp}.md`);
    fs.writeFileSync(outPath, out + '\n', 'utf8');
    process.stdout.write(out + `\n\n[Saved to ${outPath}]\n`);
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
