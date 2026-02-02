import fs from 'node:fs';
import path from 'node:path';
import { runCouncil } from '../council/pipeline.js';
import { getGitDiff } from '../lib/diff.js';

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

  const repo = getArg('repo') || process.cwd();
  const base = getArg('base') || 'origin/main';
  const head = getArg('head') || 'HEAD';

  const diff = getGitDiff({ cwd: repo, baseRef: base, headRef: head, maxChars: 160_000 });
  const result = await runCouncil({ apiKey, repoLabel: repo, diff });

  const outDir = getArg('out') || path.resolve(process.cwd(), 'out');
  fs.mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(outDir, `council-${stamp}.json`);
  const mdPath = path.join(outDir, `council-${stamp}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(mdPath, result.synthesized.summaryMd, 'utf8');

  console.log(`Wrote:\n- ${mdPath}\n- ${jsonPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
