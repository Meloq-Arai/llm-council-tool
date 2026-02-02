import path from 'node:path';
import { appendJsonl } from '../storage/jsonl.js';
import { FeedbackEvent } from '../learning/types.js';

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  const suggestionId = getArg('suggestion');
  if (!suggestionId) throw new Error('Missing --suggestion <id>');

  const accept = process.argv.includes('--accept');
  const reject = process.argv.includes('--reject');
  if (accept === reject) throw new Error('Specify exactly one of --accept or --reject');

  const note = getArg('note');

  const file = getArg('file') || path.resolve(process.cwd(), 'data', 'feedback.jsonl');

  const ev: FeedbackEvent = {
    kind: 'feedback',
    ts: new Date().toISOString(),
    suggestionId,
    accepted: accept,
    note: note || undefined,
  };

  appendJsonl(file, ev);
  console.log(`Recorded feedback to ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
