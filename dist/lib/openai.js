export async function callOpenAI({ apiKey, model, prompt, timeoutMs = 120_000 }) {
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
            const text = await resp.text();
            throw new Error(`OpenAI API error: ${resp.status} ${resp.statusText}\n${text}`);
        }
        const data = await resp.json();
        const outputText = data.output_text ||
            data.output?.map((o) => o?.content?.map((c) => c?.text)?.join('')).join('\n') ||
            '';
        return outputText || JSON.stringify(data, null, 2);
    }
    finally {
        clearTimeout(t);
    }
}
