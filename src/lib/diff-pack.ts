export type DiffFileBlock = {
  path: string;
  patch: string;
};

export type PackDiffOptions = {
  maxFiles?: number;
  maxCharsPerFile?: number;
  maxTotalChars?: number;
  minChangeChars?: number;
};

function shouldReviewPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.lock')) return false;
  if (lower.endsWith('package-lock.json')) return false;
  if (lower.endsWith('pnpm-lock.yaml')) return false;
  if (lower.endsWith('yarn.lock')) return false;
  if (lower.includes('/dist/') || lower.includes('\\dist\\')) return false;
  if (lower.includes('/build/') || lower.includes('\\build\\')) return false;
  if (lower.includes('/vendor/') || lower.includes('\\vendor\\')) return false;
  if (lower.endsWith('.min.js') || lower.endsWith('.min.css')) return false;
  return true;
}

export function splitUnifiedDiffByFile(diff: string): DiffFileBlock[] {
  const lines = diff.split(/\r?\n/);
  const out: DiffFileBlock[] = [];

  let curPath: string | null = null;
  let cur: string[] = [];

  function flush() {
    if (!curPath) return;
    const patch = cur.join('\n').trimEnd();
    out.push({ path: curPath, patch });
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush();
      cur = [line];

      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      curPath = (m?.[2] ?? m?.[1] ?? '').trim() || null;
      continue;
    }

    if (curPath) cur.push(line);
  }

  flush();
  return out;
}

export function packUnifiedDiffForPrompt(diff: string, opts: PackDiffOptions = {}): {
  text: string;
  selectedFiles: string[];
  truncated: boolean;
} {
  const {
    maxFiles = 25,
    maxCharsPerFile = 6000,
    maxTotalChars = 120_000,
    minChangeChars = 200,
  } = opts;

  const blocks = splitUnifiedDiffByFile(diff)
    .filter((b) => shouldReviewPath(b.path))
    .filter((b) => b.patch.length >= minChangeChars)
    .slice(0, maxFiles);

  const parts: string[] = [];
  const selectedFiles: string[] = [];
  let total = 0;
  let truncated = false;

  for (const b of blocks) {
    const patch = b.patch.slice(0, maxCharsPerFile);
    const block = `FILE: ${b.path}\nPATCH:\n${patch}\n`;

    if (total + block.length > maxTotalChars) {
      truncated = true;
      break;
    }

    parts.push(block);
    selectedFiles.push(b.path);
    total += block.length;
  }

  const text = parts.join('\n---\n');
  return { text, selectedFiles, truncated };
}
