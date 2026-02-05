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
function isRetryableStatus(status) {
    return status === 429 || (status >= 500 && status <= 599);
}
function extractText(data) {
    const t = data?.choices?.[0]?.message?.content;
    if (typeof t === 'string' && t.trim())
        return t;
    return '';
}
function extractUsage(data) {
    const u = data?.usage;
    if (!u)
        return undefined;
    // OpenAI-compatible names
    const inputTokens = Number.isFinite(u.prompt_tokens) ? Number(u.prompt_tokens) : undefined;
    const outputTokens = Number.isFinite(u.completion_tokens) ? Number(u.completion_tokens) : undefined;
    const totalTokens = Number.isFinite(u.total_tokens) ? Number(u.total_tokens) : undefined;
    if (inputTokens || outputTokens || totalTokens)
        return { inputTokens, outputTokens, totalTokens };
    return undefined;
}
export async function callGithubModels({ token, model, messages, timeoutMs = 120_000, maxRetries = 3, retryBaseDelayMs = 1000, temperature, maxTokens, }) {
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), timeoutMs);
        try {
            const resp = await fetch('https://models.inference.ai.azure.com/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    model,
                    messages,
                    ...(typeof temperature === 'number' ? { temperature } : {}),
                    ...(typeof maxTokens === 'number' ? { max_tokens: maxTokens } : {}),
                }),
                signal: ac.signal,
            });
            if (!resp.ok) {
                const text = await resp.text().catch(() => '');
                const err = new Error(`GitHub Models API error: ${resp.status} ${resp.statusText}${text ? `\n${text}` : ''}`);
                if (attempt < maxRetries && isRetryableStatus(resp.status)) {
                    const retryAfterMs = parseRetryAfterMs(resp.headers.get('retry-after'));
                    const backoff = retryAfterMs ??
                        Math.round(retryBaseDelayMs * Math.pow(2, attempt) * (0.9 + Math.random() * 0.2));
                    await sleep(backoff);
                    continue;
                }
                throw err;
            }
            const data = await resp.json();
            const text = extractText(data);
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
                await sleep(backoff);
                continue;
            }
            throw isAbort ? new Error(`GitHub Models request timed out after ${timeoutMs}ms`) : e;
        }
        finally {
            clearTimeout(t);
        }
    }
    throw lastErr ?? new Error('GitHub Models request failed');
}
