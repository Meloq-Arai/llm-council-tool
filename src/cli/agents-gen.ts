import fs from 'node:fs';
import path from 'node:path';
import { readJsonl } from '../storage/jsonl.js';
import { aggregateRules, renderAgentsMd } from '../learning/aggregate.js';
import { FeedbackEvent } from '../learning/types.js';

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  const feedbackFile = getArg('feedback') || path.resolve(process.cwd(), 'data', 'feedback.jsonl');
  const outFile = getArg('out') || path.resolve(process.cwd(), 'AGENTS.md');

  const events = readJsonl<FeedbackEvent>(feedbackFile).filter((e) => e?.kind === 'feedback');
  const rules = aggregateRules(events);
  const md = renderAgentsMd(rules);

  fs.writeFileSync(outFile, md, 'utf8');
  console.log(`Wrote ${outFile} (rules: ${rules.length})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
