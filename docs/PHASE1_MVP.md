# Phase 1 — MVP (local-first)

This project can run locally without GitHub integration.

## Local review (single model)

Prereqs:
- Node 20+ installed
- `OPENAI_API_KEY` set in environment

Build:
```bash
npm install
npm run build
```

Run (reviews git diff origin/main...HEAD):
```bash
set OPENAI_API_KEY=...
set OPENAI_MODEL=gpt-5.2
npm run review:local -- --repo "C:\path\to\repo" --base origin/main --head HEAD --out "C:\CORE\Projects\Code\Tools\LLM_Council_Tool\out"
```

Outputs:
- writes a timestamped `review-*.md` under `out/`

## GitHub Action

Scaffold exists (`action.yml`, `src/index.ts`), but wiring to GitHub is deferred.
