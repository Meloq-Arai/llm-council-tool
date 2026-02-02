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
export function parseStageOutput(text, stageId) {
    const obj = extractFirstJsonObject(text);
    if (!obj || typeof obj !== 'object') {
        // Fallback to empty results (safe)
        return { findings: [] };
    }
    const findingsIn = Array.isArray(obj.findings) ? obj.findings : [];
    const findings = findingsIn
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
    const questions = Array.isArray(obj.questions)
        ? obj.questions.map((q) => String(q)).filter(Boolean)
        : [];
    const summary = typeof obj.summary === 'string' ? obj.summary : undefined;
    return { summary, findings, questions };
}
