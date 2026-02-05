import { guessCostTier } from '../lib/cost-tier.js';
function fmt(n) {
    return Number.isFinite(n) ? String(n) : '?';
}
function tokensLine(usage) {
    if (!usage)
        return '';
    let totalIn = 0;
    let totalOut = 0;
    let total = 0;
    for (const u of Object.values(usage)) {
        if (!u)
            continue;
        totalIn += Number(u.inputTokens ?? 0);
        totalOut += Number(u.outputTokens ?? 0);
        total += Number(u.totalTokens ?? 0);
    }
    if (!total && !totalIn && !totalOut)
        return '';
    return `Tokens (all stages): in ${fmt(totalIn)} · out ${fmt(totalOut)} · total ${fmt(total)}`;
}
function renderIssue(i) {
    const loc = i.line_range ? `:${i.line_range.start}-${i.line_range.end}` : '';
    const conf = `${Math.round(i.confidence * 100)}%`;
    return [
        `- **${i.title}** — _${i.severity}/${i.category}_ (conf ${conf})`,
        `  - Location: \`${i.file}${loc}\``,
        `  - Why: ${i.why_this_matters}`,
        `  - Evidence: ${i.evidence}`,
        `  - Suggestion: ${i.suggestion}`,
    ].join('\n');
}
export function renderMarkdown(out) {
    const marker = '<!-- llm-council-tool -->';
    const models = out.models;
    const stageModels = [
        ...models.reviewers.map((m) => `reviewer:${m}(${guessCostTier(m)})`),
        `judge:${models.judge}(${guessCostTier(models.judge)})`,
        `verifier:${models.verifier}(${guessCostTier(models.verifier)})`,
        ...(models.verifier2 ? [`verifier2:${models.verifier2}(${guessCostTier(models.verifier2)})`] : []),
        ...(models.critic ? [`critic:${models.critic}(${guessCostTier(models.critic)})`] : []),
        ...(models.finalizer ? [`finalizer:${models.finalizer}(${guessCostTier(models.finalizer)})`] : []),
    ].join(' · ');
    const lines = [];
    lines.push(marker);
    lines.push('## 🤖 LLM Council Review');
    lines.push('');
    lines.push(stageModels);
    lines.push('');
    const tl = tokensLine(out.usage);
    if (tl) {
        lines.push(tl);
        lines.push('');
    }
    lines.push(`Confirmed: **${out.summary.confirmedCount}** · Uncertain: **${out.summary.uncertainCount}**`);
    if (out.summary.truncatedDiff)
        lines.push(`(Diff truncated)`);
    lines.push('');
    lines.push('### Confirmed issues');
    lines.push('');
    if (!out.issues.confirmed.length)
        lines.push('- (none)');
    for (const i of out.issues.confirmed)
        lines.push(renderIssue(i));
    lines.push('');
    lines.push('### Uncertain / needs human check');
    lines.push('');
    if (!out.issues.uncertain.length)
        lines.push('- (none)');
    for (const i of out.issues.uncertain)
        lines.push(renderIssue(i));
    lines.push('');
    if (out.usage) {
        lines.push('<details>');
        lines.push('<summary>Tokens per stage</summary>');
        lines.push('');
        lines.push('```json');
        lines.push(JSON.stringify(out.usage, null, 2));
        lines.push('```');
        lines.push('</details>');
    }
    return lines.join('\n');
}
