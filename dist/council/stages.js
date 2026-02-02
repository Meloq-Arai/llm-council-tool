// Phase 2 default council (can be customized via config later)
export const defaultStages = [
    { id: 'triage', role: 'Triage', model: 'gpt-5.2' },
    { id: 'architect', role: 'Architect', model: 'gpt-5.2' },
    { id: 'bug_hunter', role: 'Bug Hunter', model: 'gpt-5.2' },
    { id: 'style', role: 'Style', model: 'gpt-5.2' },
    { id: 'synthesizer', role: 'Synthesizer', model: 'gpt-5.2' },
];
