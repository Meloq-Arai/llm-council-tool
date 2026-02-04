function stripCodeFence(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fence?.[1] ?? text).trim();
}

function findJsonSlice(text: string): string | null {
  const s = stripCodeFence(text);
  let start = s.indexOf('{');
  while (start !== -1) {
    let depth = 0;
    let inStr = false;
    let esc = false;

    for (let i = start; i < s.length; i++) {
      const ch = s[i];

      if (inStr) {
        if (esc) {
          esc = false;
          continue;
        }
        if (ch === '\\') {
          esc = true;
          continue;
        }
        if (ch === '"') {
          inStr = false;
        }
        continue;
      }

      if (ch === '"') {
        inStr = true;
        continue;
      }

      if (ch === '{') depth++;
      if (ch === '}') depth--;

      if (depth === 0) {
        return s.slice(start, i + 1);
      }
    }

    // If we didn't close braces, try next '{'
    start = s.indexOf('{', start + 1);
  }

  return null;
}

export function extractFirstJsonObject(text: string): any | null {
  const slice = findJsonSlice(text);
  if (!slice) return null;
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}
