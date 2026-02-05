import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function json(cmd) {
  return JSON.parse(sh(cmd));
}

function severityRank(s) {
  const m = { critical: 4, high: 3, medium: 2, low: 1 };
  return m[String(s || '').toLowerCase()] ?? 0;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function downloadAndExtractArtifact(repo, artifactId, outDir) {
  ensureDir(outDir);
  const zipPath = path.join(outDir, `artifact-${artifactId}.zip`);

  // Download
  const bin = execSync(`gh api /repos/${repo}/actions/artifacts/${artifactId}/zip`, { encoding: 'buffer' });
  fs.writeFileSync(zipPath, bin);

  // Extract (tar can unpack zip on GH runners + Windows)
  const extractDir = path.join(outDir, 'unzipped');
  ensureDir(extractDir);
  execSync(`tar -xf "${zipPath}" -C "${extractDir}"`);

  const metaPath = path.join(extractDir, 'meta.json');
  const reviewPath = path.join(extractDir, 'review.md');
  const usagePath = path.join(extractDir, 'usage.json');

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const review = fs.existsSync(reviewPath) ? fs.readFileSync(reviewPath, 'utf8') : '';
  const usage = fs.existsSync(usagePath) ? JSON.parse(fs.readFileSync(usagePath, 'utf8')) : null;

  return { meta, review, usage, extractDir };
}

function getWorkflowId(repo, workflowName) {
  const data = json(`gh api /repos/${repo}/actions/workflows`);
  const wf = (data.workflows || []).find((w) => w.name === workflowName);
  if (!wf) throw new Error(`Workflow not found: ${workflowName} in ${repo}`);
  return wf.id;
}

function getLatestSuccessfulRun(repo, workflowId, branch) {
  // IMPORTANT: gh api will switch to POST when fields are provided unless we force GET.
  const data = json(
    `gh api -X GET /repos/${repo}/actions/workflows/${workflowId}/runs -f branch=${branch} -f per_page=20`
  );
  const runs = data.workflow_runs || [];
  const ok = runs.find((r) => r.status === 'completed' && r.conclusion === 'success');
  if (!ok) throw new Error(`No successful run found for ${repo} workflowId=${workflowId} branch=${branch}`);
  return ok;
}

function getFirstArtifactId(repo, runId) {
  const data = json(`gh api /repos/${repo}/actions/runs/${runId}/artifacts`);
  const a = (data.artifacts || [])[0];
  if (!a) throw new Error(`No artifacts for run ${runId}`);
  return a.id;
}

function evaluateCase(c, meta) {
  const confirmed = meta?.issues?.confirmed ?? [];
  const confirmedCount = Number(meta?.summary?.confirmedCount ?? confirmed.length);

  const out = { ok: true, problems: [], confirmedCount };

  if (c.expect?.minConfirmed != null && confirmedCount < c.expect.minConfirmed) {
    out.ok = false;
    out.problems.push(`confirmedCount ${confirmedCount} < minConfirmed ${c.expect.minConfirmed}`);
  }

  if (c.expect?.maxConfirmed != null && confirmedCount > c.expect.maxConfirmed) {
    out.ok = false;
    out.problems.push(`confirmedCount ${confirmedCount} > maxConfirmed ${c.expect.maxConfirmed}`);
  }

  if (c.expect?.maxCritical != null) {
    const crit = confirmed.filter((i) => String(i.severity).toLowerCase() === 'critical').length;
    if (crit > c.expect.maxCritical) {
      out.ok = false;
      out.problems.push(`critical ${crit} > maxCritical ${c.expect.maxCritical}`);
    }
  }

  if (c.expect?.maxSeverity) {
    const allowed = severityRank(c.expect.maxSeverity);
    const worst = Math.max(...confirmed.map((i) => severityRank(i.severity)), 0);
    if (worst > allowed) {
      out.ok = false;
      out.problems.push(`worstSeverityRank ${worst} > allowed(${c.expect.maxSeverity})`);
    }
  }

  return out;
}

const suitePath = process.argv[2] ?? 'eval/suite.json';
const suite = JSON.parse(fs.readFileSync(suitePath, 'utf8'));

const results = [];

for (const c of suite.cases) {
  const workflowId = getWorkflowId(c.repo, c.workflow);
  const run = getLatestSuccessfulRun(c.repo, workflowId, c.branch);
  const artifactId = getFirstArtifactId(c.repo, run.id);

  const outDir = path.join('eval', 'out', c.name);
  const { meta } = downloadAndExtractArtifact(c.repo, artifactId, outDir);

  const evalRes = evaluateCase(c, meta);
  results.push({ case: c.name, repo: c.repo, branch: c.branch, runId: run.id, artifactId, ...evalRes });
}

console.log(JSON.stringify({ results }, null, 2));

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  process.exitCode = 1;
}
