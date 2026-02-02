export type OpenAIReviewRequest = {
  apiKey: string;
  model: string;
  prompt: string;
  timeoutMs?: number;
};

export async function callOpenAI({ apiKey, model, prompt, timeoutMs = 120_000 }: OpenAIReviewRequest): Promise<string> {
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

    const data: any = await resp.json();
    const outputText: string =
      data.output_text ||
      data.output?.map((o: any) => o?.content?.map((c: any) => c?.text)?.join('') ).join('\n') ||
      '';

    return outputText || JSON.stringify(data, null, 2);
  } finally {
    clearTimeout(t);
  }
}
