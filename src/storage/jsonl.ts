import fs from 'node:fs';
import path from 'node:path';

export function appendJsonl(filePath: string, event: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(event) + '\n', 'utf8');
}

export function readJsonl<T = any>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  const txt = fs.readFileSync(filePath, 'utf8');
  const lines = txt.split(/\r?\n/).filter(Boolean);
  const out: T[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip bad line
    }
  }
  return out;
}
