import { execSync } from 'node:child_process';
export function getGitDiff({ cwd, baseRef = 'origin/main', headRef = 'HEAD', maxChars = 120_000 }) {
    // Note: This assumes the repo has fetched origin/main.
    // If not, user can run: git fetch origin main
    const cmd = `git diff --no-color ${baseRef}...${headRef}`;
    return execDiff(cwd, cmd, maxChars);
}
export function getStagedDiff({ cwd, maxChars = 120_000 }) {
    const cmd = `git diff --no-color --cached`;
    return execDiff(cwd, cmd, maxChars);
}
function execDiff(cwd, cmd, maxChars) {
    const out = execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (out.length > maxChars)
        return out.slice(0, maxChars) + '\n\n[diff truncated]\n';
    return out;
}
