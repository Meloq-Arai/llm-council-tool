function toGeminiContents(messages) {
    // Gemini API uses role user/model. We approximate.
    const contents = [];
    for (const m of messages) {
        const role = m.role === 'assistant' ? 'model' : 'user';
        const parts = [{ text: m.content }];
        contents.push({ role, parts });
    }
    return contents;
}
export async function callGemini({ apiKey, model, messages, timeoutMs = 120_000 }) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
        // v1beta is still the common endpoint for Gemini API key auth.
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: toGeminiContents(messages),
                generationConfig: {
                    temperature: 0.2,
                },
            }),
            signal: ac.signal,
        });
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new Error(`Gemini API error: ${resp.status} ${resp.statusText}${text ? `\n${text}` : ''}`);
        }
        const data = await resp.json();
        const text = data?.candidates?.[0]?.content?.parts?.map((p) => p?.text ?? '').join('') ??
            '';
        return { text: String(text || '').trim() || JSON.stringify(data, null, 2), raw: data };
    }
    finally {
        clearTimeout(t);
    }
}
