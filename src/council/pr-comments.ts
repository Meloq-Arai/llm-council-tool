import type { FinalIssue } from './schema.js';

export type InlineComment = {
  path: string;
  line: number;
  body: string;
};

// Very conservative: only produce an inline comment when we have a clear file + line_range.
// GitHub PR review comments require accurate positions/lines; we avoid guessing.
export function issuesToInlineComments(issues: FinalIssue[]): InlineComment[] {
  const out: InlineComment[] = [];

  for (const i of issues) {
    if (!i.file) continue;
    const lr = i.line_range;
    if (!lr?.start) continue;

    out.push({
      path: i.file,
      line: lr.start,
      body:
        `**${i.title}** (_${i.severity}/${i.category}_, conf ${(i.confidence * 100).toFixed(0)}%)\n\n` +
        `Evidence: ${i.evidence}\n\n` +
        `Suggestion: ${i.suggestion}`,
    });
  }

  // De-dupe by path+line
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = `${c.path}::${c.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
