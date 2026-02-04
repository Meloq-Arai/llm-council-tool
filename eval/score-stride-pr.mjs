import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repo = process.argv[2] ?? 'Meloq-Arai/Stride';
const pr = Number(process.argv[3] ?? 2);

function getActionCommentBody() {
  const raw = execSync(`gh pr view ${pr} --repo ${repo} --json comments`, { encoding: 'utf8' });
  const j = JSON.parse(raw);
  const c = j.comments.find((x) => x.author?.login === 'github-actions' && String(x.body ?? '').includes('<!-- llm-council-tool -->'));
  if (!c) throw new Error('Could not find github-actions comment containing <!-- llm-council-tool -->');
  return { id: c.id, body: String(c.body ?? '') };
}

function detectCategories(text) {
  const t = text.toLowerCase();
  const has = (re) => re.test(t);

  const out = new Set();

  if (has(/json\.parse/) || has(/unsafe json/) || has(/parseinput/)) out.add('UNSAFE_JSON_PARSE');
  if (has(/loose equality/) || has(/==\s*0/) || has(/strict equality/) || has(/coercion/)) out.add('LOOSE_EQUALITY');
  if (has(/\beval\b/) || has(/dynamic code execution/)) out.add('DYNAMIC_EVAL');
  if (has(/redos/) || has(/catastrophic backtracking/) || has(/\^\(a\+\)\+\$|\^\(a\+\)\)\+\$/)) out.add('REGEX_REDOS');
  if (has(/missing\s+await/) || has(/await\s+fetcher/) || has(/unresolved promise/)) out.add('MISSING_AWAIT');
  if (has(/\bany\b/) || has(/poor typing/) || has(/unknown/) || has(/typing/)) out.add('ANY_TYPING');
  if (has(/path traversal/) || has(/readfile/) || has(/readuserfile/) || has(/untrusted path/)) out.add('PATH_TRAVERSAL_READ');
  if (has(/math\.random/) || has(/weak random/) || has(/insecure random/)) out.add('WEAK_RANDOMNESS');

  return [...out].sort();
}

function score(expected, found) {
  const exp = new Set(expected);
  const fnd = new Set(found);

  let tp = 0;
  for (const c of fnd) if (exp.has(c)) tp++;

  const fp = found.length - tp;
  const fn = expected.length - tp;

  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const f1 = (2 * precision * recall) / Math.max(1e-9, precision + recall);

  return { tp, fp, fn, precision, recall, f1 };
}

const expectedPath = path.resolve('eval/expected/stride-bench.json');
const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));

const { id, body } = getActionCommentBody();
const found = detectCategories(body);
const s = score(expected.categories, found);

console.log(JSON.stringify({ repo, pr, commentId: id, expected: expected.categories, found, score: s }, null, 2));
