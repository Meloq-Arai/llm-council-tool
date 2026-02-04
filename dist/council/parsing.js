import { extractFirstJsonObject } from './json.js';
function slug(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);
}
function normalizeSeverity(s) {
    const v = String(s || 'medium').toLowerCase();
    if (v === 'info' || v === 'low' || v === 'medium' || v === 'high' || v === 'critical')
        return v;
    return 'medium';
}
function clampLine(n) {
    const v = Number(n);
    if (!Number.isFinite(v))
        return undefined;
    if (v <= 0)
        return undefined;
    return Math.floor(v);
}
export function parseStageOutput(text, stageId) {
    const obj = extractFirstJsonObject(text);
    if (!obj || typeof obj !== 'object') {
        return { ok: false, findings: [] };
    }
    const findingsIn = Array.isArray(obj.findings) ? obj.findings : [];
    const findings = findingsIn
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
    const questions = Array.isArray(obj.questions)
        ? obj.questions.map((q) => String(q)).map((s) => s.trim()).filter(Boolean).slice(0, 20)
        : [];
    const summary = typeof obj.summary === 'string' ? obj.summary.trim().slice(0, 4000) : undefined;
    return { ok: true, summary, findings, questions, raw: obj };
}
