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

export function parseStageOutput(text: string, stageId: string): { summary?: string; findings: Finding[]; questions?: string[] } {
  const obj = extractFirstJsonObject(text);
  if (!obj || typeof obj !== 'object') {
    // Fallback to empty results (safe)
    return { findings: [] };
  }

  const findingsIn: any[] = Array.isArray((obj as any).findings) ? (obj as any).findings : [];
  const findings: Finding[] = findingsIn
    .filter((f) => f && typeof f === 'object')
    .map((f, i) => {
      const title = String(f.title || '').trim().slice(0, 120) || `Finding ${i + 1}`;
      return {
        id: `${stageId}:${slug(title)}:${i + 1}`,
        title,
        severity: normalizeSeverity(f.severity),
        file: f.file ? String(f.file) : undefined,
        lineStart: Number.isFinite(f.lineStart) ? Number(f.lineStart) : undefined,
        lineEnd: Number.isFinite(f.lineEnd) ? Number(f.lineEnd) : undefined,
        message: String(f.message || '').trim() || title,
        suggestion: f.suggestion ? String(f.suggestion) : undefined,
        sourceStage: stageId,
        confidence: 0.55,
      };
    });

  const questions: string[] = Array.isArray((obj as any).questions)
    ? (obj as any).questions.map((q: any) => String(q)).filter(Boolean)
    : [];

  const summary = typeof (obj as any).summary === 'string' ? (obj as any).summary : undefined;

  return { summary, findings, questions };
}
