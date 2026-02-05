// Map detected categories/tags to GitHub labels.
// Keep labels stable and human-friendly.
export function labelsForIssues(issues) {
    const set = new Set();
    const add = (x) => {
        const s = x.trim();
        if (s)
            set.add(s);
    };
    for (const i of issues) {
        const c = String(i.category || '').toLowerCase();
        const title = String(i.title || '').toLowerCase();
        const tags = (i.tags ?? []).map((t) => String(t).toLowerCase());
        if (c.includes('security') || title.includes('xss') || title.includes('csrf') || title.includes('injection')) {
            add('needs-security-review');
        }
        if (c.includes('regex') || title.includes('redos') || title.includes('catastrophic backtracking')) {
            add('has-potential-regex-redos');
        }
        if (c.includes('perf') || title.includes('performance')) {
            add('has-performance-risk');
        }
        if (tags.includes('breaking-change')) {
            add('possible-breaking-change');
        }
    }
    return [...set];
}
