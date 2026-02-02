export function extractFirstJsonObject(text: string): any | null {
  // Try code-fenced JSON first
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence?.[1] ?? text;

  // Heuristic: find first '{' and last '}' after it
  const start = candidate.indexOf('{');
  if (start === -1) return null;
  const end = candidate.lastIndexOf('}');
  if (end === -1 || end <= start) return null;

  const slice = candidate.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}
