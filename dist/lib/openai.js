function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function parseRetryAfterMs(h) {
    if (!h)
        return undefined;
    const s = Number(h);
    if (Number.isFinite(s) && s > 0)
        return Math.round(s * 1000);
    return undefined;
}
function extractOutputText(data) {
    if (!data)
        return '';
    if (typeof data.output_text === 'string' && data.output_text.trim())
        return data.output_text;
    const parts = (data.output ?? [])
        .map((o) => (o?.content ?? []).map((c) => c?.text ?? '').join(''))
        .filter((s) => s && String(s).trim());
    if (parts.length)
        return parts.join('\n');
    return '';
}
function extractUsage(data) {
    const u = data?.usage;
    if (!u)
        return undefined;
    // Responses API commonly returns { input_tokens, output_tokens, total_tokens }
    const inputTokens = Number.isFinite(u.input_tokens) ? Number(u.input_tokens) : undefined;
    const outputTokens = Number.isFinite(u.output_tokens) ? Number(u.output_tokens) : undefined;
    const totalTokens = Number.isFinite(u.total_tokens) ? Number(u.total_tokens) : undefined;
    if (inputTokens || outputTokens || totalTokens)
        return { inputTokens, outputTokens, totalTokens };
    return undefined;
}
function isRetryableStatus(status) {
    return status === 429 || (status >= 500 && status <= 599);
}
export async function callOpenAI({ apiKey, model, prompt, timeoutMs = 120_000, maxRetries = 3, retryBaseDelayMs = 1000 }) {
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), timeoutMs);
        try {
            const resp = await fetch('https://api.openai.com/v1/responses', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    input: prompt,
                }),
                signal: ac.signal,
            });
            if (!resp.ok) {
                const text = await resp.text().catch(() => '');
                const err = new Error(`OpenAI API error: ${resp.status} ${resp.statusText}${text ? `\n${text}` : ''}`);
                if (attempt < maxRetries && isRetryableStatus(resp.status)) {
                    const retryAfterMs = parseRetryAfterMs(resp.headers.get('retry-after'));
                    const backoff = retryAfterMs ?? Math.round(retryBaseDelayMs * Math.pow(2, attempt) * (0.9 + Math.random() * 0.2));
                    await sleep(backoff);
                    continue;
                }
                throw err;
            }
            const data = await resp.json();
            const text = extractOutputText(data);
            return {
                text: text || JSON.stringify(data, null, 2),
                usage: extractUsage(data),
                raw: data,
            };
        }
        catch (e) {
            lastErr = e;
            const isAbort = e?.name === 'AbortError';
            if (attempt < maxRetries) {
                const backoff = Math.round(retryBaseDelayMs * Math.pow(2, attempt) * (0.9 + Math.random() * 0.2));
                // Abort could be a transient network issue; treat it as retryable.
                await sleep(backoff);
                continue;
            }
            throw isAbort ? new Error(`OpenAI request timed out after ${timeoutMs}ms`) : e;
        }
        finally {
            clearTimeout(t);
        }
    }
    throw lastErr ?? new Error('OpenAI request failed');
}
