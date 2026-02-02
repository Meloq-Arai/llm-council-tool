export function buildReviewPrompt(diff, opts = {}) {
    const repo = opts.repoName ? `Repository: ${opts.repoName}\n` : '';
    const extra = opts.instructions ? `\nAdditional instructions:\n${opts.instructions}\n` : '';
    return (`You are a senior code reviewer. Review this git diff.\n\n` +
        `${repo}` +
        `Rules:\n` +
        `- Be concise and specific.\n` +
        `- Prioritize correctness, security, edge cases, performance, maintainability.\n` +
        `- If you suggest a change, show a short code snippet.\n` +
        `- Output Markdown with sections: Summary, High-risk issues, Suggestions, Questions.\n` +
        `${extra}\n` +
        `Diff:\n\n` +
        diff);
}
