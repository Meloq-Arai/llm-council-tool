export type GithubModelsChatRequest = {
  token: string;
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'developer'; content: string }>;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  temperature?: number;
  maxTokens?: number;
};

export type GithubModelsUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type GithubModelsResult = {
  text: string;
  usage?: GithubModelsUsage;
  raw: any;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfterMs(h: string | null): number | undefined {
  if (!h) return undefined;
  const s = Number(h);
  if (Number.isFinite(s) && s > 0) return Math.round(s * 1000);
  return undefined;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function extractText(data: any): string {
  const t = data?.choices?.[0]?.message?.content;
  if (typeof t === 'string' && t.trim()) return t;
  return '';
}

function extractUsage(data: any): GithubModelsUsage | undefined {
  const u = data?.usage;
  if (!u) return undefined;

  // OpenAI-compatible names
  const inputTokens = Number.isFinite(u.prompt_tokens) ? Number(u.prompt_tokens) : undefined;
  const outputTokens = Number.isFinite(u.completion_tokens) ? Number(u.completion_tokens) : undefined;
  const totalTokens = Number.isFinite(u.total_tokens) ? Number(u.total_tokens) : undefined;

  if (inputTokens || outputTokens || totalTokens) return { inputTokens, outputTokens, totalTokens };
  return undefined;
}

export async function listGithubModels(token: string): Promise<Array<{ name: string }>> {
  const resp = await fetch('https://models.inference.ai.azure.com/models', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`GitHub Models list error: ${resp.status} ${resp.statusText}${text ? `\n${text}` : ''}`);
  }
  const data: any = await resp.json();
  if (!Array.isArray(data)) return [];
  return data
    .map((m: any) => ({ name: String(m?.name ?? m?.id ?? '') }))
    .filter((m: any) => m.name && m.name !== '[object Object]');
}

export async function callGithubModels(
  {
    token,
    model,
    messages,
    timeoutMs = 120_000,
    maxRetries = 3,
    retryBaseDelayMs = 1000,
    temperature,
    maxTokens,
  }: GithubModelsChatRequest
): Promise<GithubModelsResult> {
  let lastErr: any;

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
        const err = new Error(
          `GitHub Models API error: ${resp.status} ${resp.statusText}${text ? `\n${text}` : ''}`
        );

        if (attempt < maxRetries && isRetryableStatus(resp.status)) {
          const retryAfterMs = parseRetryAfterMs(resp.headers.get('retry-after'));
          const backoff =
            retryAfterMs ??
            Math.round(retryBaseDelayMs * Math.pow(2, attempt) * (0.9 + Math.random() * 0.2));
          await sleep(backoff);
          continue;
        }

        throw err;
      }

      const data: any = await resp.json();
      const text = extractText(data);
      return {
        text: text || JSON.stringify(data, null, 2),
        usage: extractUsage(data),
        raw: data,
      };
    } catch (e: any) {
      lastErr = e;
      const isAbort = e?.name === 'AbortError';
      if (attempt < maxRetries) {
        const backoff = Math.round(retryBaseDelayMs * Math.pow(2, attempt) * (0.9 + Math.random() * 0.2));
        await sleep(backoff);
        continue;
      }
      throw isAbort ? new Error(`GitHub Models request timed out after ${timeoutMs}ms`) : e;
    } finally {
      clearTimeout(t);
    }
  }

  throw lastErr ?? new Error('GitHub Models request failed');
}
