import { extractFirstJsonObject } from './json.js';
import { Finding, Severity } from './types.js';

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);
}

function normalizeSeverity(s: any): Severity {
  const v = String(s || 'medium').toLowerCase();
  if (v === 'info' || v === 'low' || v === 'medium' || v === 'high' || v === 'critical') return v;
  return 'medium';
}

function clampLine(n: any): number | undefined {
  const v = Number(n);
  if (!Number.isFinite(v)) return undefined;
  if (v <= 0) return undefined;
  return Math.floor(v);
}

export function parseStageOutput(
  text: string,
  stageId: string
): { ok: boolean; summary?: string; findings: Finding[]; questions?: string[]; raw?: any } {
  const obj = extractFirstJsonObject(text);
  if (!obj || typeof obj !== 'object') {
    return { ok: false, findings: [] };
  }

  const findingsIn: any[] = Array.isArray((obj as any).findings) ? (obj as any).findings : [];
  const findings: Finding[] = findingsIn
    .filter((f) => f && typeof f === 'object')
    .map((f, i) => {
      const title = String(f.title || '').trim().slice(0, 120) || `Finding ${i + 1}`;
      const message = String(f.message || '').trim().slice(0, 5000) || title;
      const suggestion = f.suggestion ? String(f.suggestion).trim().slice(0, 5000) : undefined;

      return {
        id: `${stageId}:${slug(title)}:${i + 1}`,
        title,
        severity: normalizeSeverity(f.severity),
        file: f.file ? String(f.file) : undefined,
        lineStart: clampLine(f.lineStart),
        lineEnd: clampLine(f.lineEnd),
        message,
        suggestion,
        sourceStage: stageId,
        confidence: 0.55,
      };
    });

  const questions: string[] = Array.isArray((obj as any).questions)
    ? (obj as any).questions.map((q: any) => String(q)).map((s: string) => s.trim()).filter(Boolean).slice(0, 20)
    : [];

  const summary = typeof (obj as any).summary === 'string' ? (obj as any).summary.trim().slice(0, 4000) : undefined;

  return { ok: true, summary, findings, questions, raw: obj };
}
