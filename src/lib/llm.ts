import { callOpenAI, type OpenAIResult } from './openai.js';
import { callGithubModels, type GithubModelsResult } from './github-models.js';

export type LLMProvider = 'openai' | 'github-models';

export type LLMMessage = {
  role: 'system' | 'user' | 'assistant' | 'developer';
  content: string;
};

export type LLMRequest = {
  provider: LLMProvider;
  model: string;
  prompt?: string; // convenience
  messages?: LLMMessage[];

  // auth
  openaiApiKey?: string;
  githubToken?: string;

  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  temperature?: number;
  maxTokens?: number;
};

export type LLMUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type LLMResult = {
  text: string;
  usage?: LLMUsage;
  raw: any;
};

export async function callLLM(req: LLMRequest): Promise<LLMResult> {
  const timeoutMs = req.timeoutMs;
  const maxRetries = req.maxRetries;
  const retryBaseDelayMs = req.retryBaseDelayMs;

  if (req.provider === 'openai') {
    if (!req.openaiApiKey) throw new Error('openaiApiKey is required for provider=openai');

    const prompt =
      req.prompt ??
      (req.messages
        ? req.messages
            .map((m) => `${m.role.toUpperCase()}:\n${m.content}`)
            .join('\n\n')
        : undefined);

    if (!prompt) throw new Error('Either prompt or messages is required for provider=openai');

    const r: OpenAIResult = await callOpenAI({
      apiKey: req.openaiApiKey,
      model: req.model,
      prompt,
      timeoutMs,
      maxRetries,
      retryBaseDelayMs,
    });

    return r;
  }

  if (req.provider === 'github-models') {
    if (!req.githubToken) throw new Error('githubToken is required for provider=github-models');

    const messages =
      req.messages ??
      (req.prompt
        ? [
            {
              role: 'user' as const,
              content: req.prompt,
            },
          ]
        : undefined);

    if (!messages) throw new Error('Either messages or prompt is required for provider=github-models');

    const r: GithubModelsResult = await callGithubModels({
      token: req.githubToken,
      model: req.model,
      messages,
      timeoutMs,
      maxRetries,
      retryBaseDelayMs,
      temperature: req.temperature,
      maxTokens: req.maxTokens,
    });

    return r;
  }

  // exhaustive
  throw new Error(`Unknown provider: ${(req as any).provider}`);
}
