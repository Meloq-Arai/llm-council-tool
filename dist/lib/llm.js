import { callOpenAI } from './openai.js';
import { callGithubModels } from './github-models.js';
import { callGemini } from './google-gemini.js';
export async function callLLM(req) {
    const timeoutMs = req.timeoutMs;
    const maxRetries = req.maxRetries;
    const retryBaseDelayMs = req.retryBaseDelayMs;
    if (req.provider === 'openai') {
        if (!req.openaiApiKey)
            throw new Error('openaiApiKey is required for provider=openai');
        const prompt = req.prompt ??
            (req.messages
                ? req.messages
                    .map((m) => `${m.role.toUpperCase()}:\n${m.content}`)
                    .join('\n\n')
                : undefined);
        if (!prompt)
            throw new Error('Either prompt or messages is required for provider=openai');
        const r = await callOpenAI({
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
        if (!req.githubToken)
            throw new Error('githubToken is required for provider=github-models');
        const messages = req.messages ??
            (req.prompt
                ? [
                    {
                        role: 'user',
                        content: req.prompt,
                    },
                ]
                : undefined);
        if (!messages)
            throw new Error('Either messages or prompt is required for provider=github-models');
        const r = await callGithubModels({
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
    if (req.provider === 'google') {
        if (!req.googleApiKey)
            throw new Error('googleApiKey is required for provider=google');
        const messages = req.messages ?? (req.prompt ? [{ role: 'user', content: req.prompt }] : undefined);
        if (!messages)
            throw new Error('Either messages or prompt is required for provider=google');
        const r = await callGemini({
            apiKey: req.googleApiKey,
            model: req.model,
            messages,
            timeoutMs,
        });
        return { text: r.text, raw: r.raw };
    }
    // exhaustive
    throw new Error(`Unknown provider: ${req.provider}`);
}
