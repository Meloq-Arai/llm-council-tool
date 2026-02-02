# LLM Council Tool (MVP)

Phase 1 goal: a **GitHub Action** that reviews PR diffs using a single model (OpenAI/Codex) and posts feedback as PR comments.

## What is a “tool repo” vs an “action”?

- **GitHub Action (recommended):** a package that can be used directly from workflows: `uses: owner/repo@ref`. It’s designed to be reused across repos.
- **Tool repo:** a normal repo containing scripts/CLI tooling. A workflow would `checkout` the repo and run `node tool.js ...`. It’s fine, but less plug‑and‑play.

We’re building an **action**.

## MVP scope

- Trigger: `pull_request`.
- Fetch PR diff (via GitHub API).
- Filter files (skip lockfiles, skip tiny changes).
- Call OpenAI model to produce review notes.
- Post results as a single PR comment (simple + reliable).

## Setup

### Required secrets

Add to the target repo’s GitHub secrets:
- `OPENAI_API_KEY`

### Optional vars

- `OPENAI_MODEL` (default set in workflow)

## Development

```bash
cd C:\CORE\Projects\Code\Tools\LLM_Council_Tool
npm install
npm run build
```

## Files

- `action.yml` — GitHub Action metadata
- `src/` — TypeScript source
- `dist/` — built JS (committed for GitHub Actions)
- `.github/workflows/example.yml` — example workflow
