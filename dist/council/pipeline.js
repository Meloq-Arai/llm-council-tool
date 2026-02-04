import { defaultStages } from './stages.js';
import { callOpenAI } from '../lib/openai.js';
import { buildRolePrompt } from '../lib/role-prompts.js';
import { packUnifiedDiffForPrompt } from '../lib/diff-pack.js';
import { mergeAndScoreFindings } from './scoring.js';
import { parseStageOutput } from './parsing.js';
export async function runCouncil(opts) {
    const stages = opts.stages ?? defaultStages;
    const maxStageChars = opts.maxStageChars ?? 120_000;
    const stageOutputs = [];
    const reviewers = stages.filter((s) => s.id !== 'synthesizer');
    const synthesizer = stages.find((s) => s.id === 'synthesizer');
    const packed = packUnifiedDiffForPrompt(opts.diff, {
        maxFiles: 40,
        maxCharsPerFile: Math.min(12_000, Math.floor(maxStageChars / 4)),
        maxTotalChars: maxStageChars,
    });
    const diffForStages = packed.text || opts.diff.slice(0, maxStageChars);
    for (const s of reviewers) {
        const basePrompt = buildRolePrompt(s.role, diffForStages);
        // First attempt
        let { text: rawText } = await callOpenAI({ apiKey: opts.apiKey, model: s.model, prompt: basePrompt, timeoutMs: 240_000 });
        let parsed = parseStageOutput(rawText, s.id);
        // Repair attempt (models occasionally wrap JSON in prose/fences)
        if (!parsed.ok) {
            const repairPrompt = `Your previous response was not valid JSON. ` +
                `Return ONLY valid JSON matching the schema. No markdown, no code fences, no extra text.\n\n` +
                basePrompt;
            ({ text: rawText } = await callOpenAI({ apiKey: opts.apiKey, model: s.model, prompt: repairPrompt, timeoutMs: 240_000 }));
            parsed = parseStageOutput(rawText, s.id);
        }
        stageOutputs.push({
            stageId: s.id,
            model: s.model,
            role: s.role,
            rawText,
            findings: parsed.findings,
            meta: {
                summary: parsed.summary,
                questions: parsed.questions,
                parseOk: parsed.ok,
            },
        });
    }
    const allFindings = stageOutputs.flatMap((s) => s.findings);
    const merged = mergeAndScoreFindings(allFindings);
    // If we have a synthesizer stage, run it using the other reviewers' results.
    if (synthesizer) {
        const councilJson = JSON.stringify({
            repoLabel: opts.repoLabel,
            reviewers: stageOutputs.map((s) => ({ stageId: s.stageId, role: s.role, findings: s.findings, meta: s.meta })),
        }, null, 2);
        const synthPrompt = `You are the Synthesizer. Merge the council findings into a final review.\n` +
            `Return ONLY Markdown.\n\n` +
            `Include sections:\n- Summary\n- High-risk issues\n- Suggestions\n- Questions\n\n` +
            `Council findings (JSON):\n\n${councilJson}`;
        const { text: rawText } = await callOpenAI({ apiKey: opts.apiKey, model: synthesizer.model, prompt: synthPrompt, timeoutMs: 240_000 });
        stageOutputs.push({
            stageId: synthesizer.id,
            model: synthesizer.model,
            role: synthesizer.role,
            rawText,
            findings: [],
            meta: { kind: 'markdown_synthesis' },
        });
        return {
            version: 1,
            createdAt: new Date().toISOString(),
            repoLabel: opts.repoLabel,
            stages: stageOutputs,
            synthesized: {
                summaryMd: rawText,
                findings: merged,
            },
        };
    }
    // Synthesized markdown (fallback local render)
    const summaryMd = renderMarkdownSummary(merged, opts.repoLabel);
    return {
        version: 1,
        createdAt: new Date().toISOString(),
        repoLabel: opts.repoLabel,
        stages: stageOutputs,
        synthesized: {
            summaryMd,
            findings: merged,
        },
    };
}
function renderMarkdownSummary(findings, repoLabel) {
    const header = repoLabel ? `# LLM Council Review — ${repoLabel}\n\n` : `# LLM Council Review\n\n`;
    if (!findings.length)
        return header + 'No findings.\n';
    const sorted = [...findings].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    const lines = [];
    lines.push(header);
    lines.push('## Summary\n');
    lines.push(`- Findings: **${sorted.length}**\n`);
    lines.push('## Findings\n');
    for (const f of sorted) {
        const conf = (f.confidence ?? 0.5).toFixed(2);
        const loc = f.file ? ` (${f.file}${f.lineStart ? `:${f.lineStart}` : ''})` : '';
        lines.push(`- **[${f.severity.toUpperCase()}]** ${f.title}${loc} — confidence ${conf}`);
        lines.push(`  - ${f.message}`);
        if (f.suggestion) {
            lines.push('  - Suggestion:');
            lines.push('');
            lines.push('```');
            lines.push(f.suggestion);
            lines.push('```');
        }
    }
    return lines.join('\n');
}
