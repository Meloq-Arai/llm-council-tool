import { FeedbackEvent, StyleRule } from './types.js';

// Very simple Phase 3 aggregator:
// - For now, treat suggestionId (or user note) as a "rule" string.
// - Accepted increases weight, rejected decreases.
export function aggregateRules(events: FeedbackEvent[]): StyleRule[] {
  const map = new Map<string, number>();

  for (const e of events) {
    const key = (e.note && e.note.trim()) ? e.note.trim() : e.suggestionId;
    const delta = e.accepted ? 1 : -1;
    map.set(key, (map.get(key) || 0) + delta);
  }

  return Array.from(map.entries())
    .map(([rule, weight]) => ({ rule, weight }))
    .filter((r) => r.weight !== 0)
    .sort((a, b) => b.weight - a.weight);
}

export function renderAgentsMd(rules: StyleRule[]): string {
  const lines: string[] = [];
  lines.push('# AGENTS.md');
  lines.push('');
  lines.push('This file captures coding/style preferences learned from prior reviews.');
  lines.push('It is safe to edit by hand.');
  lines.push('');

  const prefers = rules.filter((r) => r.weight > 0);
  const avoid = rules.filter((r) => r.weight < 0);

  if (prefers.length) {
    lines.push('## Prefer');
    for (const r of prefers) lines.push(`- ${r.rule} (score ${r.weight})`);
    lines.push('');
  }

  if (avoid.length) {
    lines.push('## Avoid');
    for (const r of avoid) lines.push(`- ${r.rule} (score ${r.weight})`);
    lines.push('');
  }

  if (!prefers.length && !avoid.length) {
    lines.push('No learned preferences yet.');
    lines.push('');
  }

  return lines.join('\n');
}
