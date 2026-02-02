export function buildRolePrompt(role: string, diff: string): string {
  const common = [
    'You are part of an AI code review council.',
    'Review the following diff and produce actionable feedback.',
    'Be concise, high-signal, and avoid nitpicks unless they reduce bugs.',
    'Output Markdown.',
  ].join('\n');

  const roleHint = (() => {
    switch (role.toLowerCase()) {
      case 'triage':
        return 'Focus on whether changes are risky/important; identify hotspots.';
      case 'architect':
        return 'Focus on design, abstractions, modularity, future scalability.';
      case 'bug hunter':
        return 'Focus on correctness, security, edge cases, race conditions.';
      case 'style':
        return 'Focus on readability, idioms, consistency, maintainability.';
      case 'synthesizer':
        return 'Merge the best points from other reviewers and produce a clean final review.';
      default:
        return 'Focus on overall quality.';
    }
  })();

  return `${common}\n\nRole: ${role}\nRole focus: ${roleHint}\n\nOutput format:\nReturn a single JSON object (no markdown) with this shape:\n{\n  \"summary\": string,\n  \"findings\": [\n    {\n      \"title\": string,\n      \"severity\": \"info\"|\"low\"|\"medium\"|\"high\"|\"critical\",\n      \"file\"?: string,\n      \"lineStart\"?: number,\n      \"lineEnd\"?: number,\n      \"message\": string,\n      \"suggestion\"?: string\n    }\n  ],\n  \"questions\": string[]\n}\n\nDiff:\n\n${diff}`;
}
