// Rough, relative cost tiers (not $). Used for quick visibility in PR comments.
// Keep this intentionally approximate; providers vary and GitHub Models doesn't expose per-call pricing.
export function guessCostTier(model) {
    const m = String(model || '').toLowerCase();
    if (!m)
        return 'medium';
    if (m.includes('gpt-5') || m.includes('o1') || m.includes('opus') || m.includes('405b'))
        return 'ultra';
    if (m.includes('gpt-4o') || m.includes('sonnet') || m.includes('gpt-4.1'))
        return 'high';
    if (m.includes('gpt-4') || m.includes('70b') || m.includes('pro'))
        return 'medium';
    if (m.includes('mini') || m.includes('flash') || m.includes('haiku') || m.includes('8b') || m.includes('nemo'))
        return 'low';
    return 'medium';
}
