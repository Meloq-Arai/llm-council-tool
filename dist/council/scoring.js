export function clamp01(n) {
    if (Number.isNaN(n))
        return 0;
    return Math.max(0, Math.min(1, n));
}
// MVP scoring: if multiple stages report similar titles, increase confidence.
export function mergeAndScoreFindings(findings) {
    const byKey = new Map();
    for (const f of findings) {
        const key = `${(f.file || '').toLowerCase()}::${f.title.toLowerCase()}`;
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, { ...f, confidence: clamp01(f.confidence ?? 0.55), sources: new Set([f.sourceStage || 'unknown']) });
        }
        else {
            existing.sources.add(f.sourceStage || 'unknown');
            // bump confidence slightly for corroboration
            existing.confidence = clamp01((existing.confidence ?? 0.55) + 0.12);
            // keep highest severity
            const sevRank = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
            if (sevRank[f.severity] > sevRank[existing.severity])
                existing.severity = f.severity;
            // keep longer message
            if ((f.message?.length || 0) > (existing.message?.length || 0))
                existing.message = f.message;
            // keep suggestion if missing
            if (!existing.suggestion && f.suggestion)
                existing.suggestion = f.suggestion;
        }
    }
    return Array.from(byKey.values()).map(({ sources, ...rest }) => ({ ...rest, confidence: clamp01((rest.confidence ?? 0.55) + Math.min(0.2, (sources.size - 1) * 0.05)) }));
}
