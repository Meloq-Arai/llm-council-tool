const SECRET_PATTERNS = [
    { name: 'OpenAI key', re: /\bsk-[A-Za-z0-9]{20,}\b/g },
    { name: 'GitHub token', re: /\bgho_[A-Za-z0-9_]{20,}\b/g },
    { name: 'Google API key', re: /\bAIza[0-9A-Za-z\-_]{20,}\b/g },
    { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/g },
    // generic high-entropy-ish tokens
    { name: 'Long token', re: /\b[A-Za-z0-9_\-]{40,}\b/g },
];
export function redactSecrets(text) {
    let out = String(text ?? '');
    const redactions = [];
    for (const p of SECRET_PATTERNS) {
        const before = out;
        out = out.replace(p.re, (m) => {
            redactions.push(p.name);
            return `[REDACTED:${p.name}]`;
        });
        if (before !== out) {
            // keep going
        }
    }
    // de-dupe
    return { text: out, redactions: [...new Set(redactions)] };
}
export function shouldSkipFileByPath(filename) {
    const f = String(filename || '').toLowerCase();
    if (!f)
        return false;
    // secrets / keys
    if (f.endsWith('.env') || f.includes('/.env') || f.includes('\\.env'))
        return true;
    if (f.endsWith('.pem') || f.endsWith('.key') || f.endsWith('.p12') || f.endsWith('.pfx'))
        return true;
    if (f.includes('id_rsa') || f.includes('id_ed25519'))
        return true;
    if (f.includes('secrets') || f.includes('secret'))
        return true;
    return false;
}
