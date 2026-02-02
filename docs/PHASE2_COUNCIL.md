# Phase 2 — The Council (local-first)

## Run council locally

```bash
set OPENAI_API_KEY=...

npm run build
npm run council:local -- --repo "C:\path\to\repo" --base origin/main --head HEAD --out "C:\CORE\Projects\Code\Tools\LLM_Council_Tool\out"
```

Outputs:
- `out/council-<timestamp>.md` — synthesizer markdown (if configured)
- `out/council-<timestamp>.json` — full structured artifact including all stage raw outputs

## Notes
- Stages are defined in `src/council/stages.ts`.
- Each reviewer stage is prompted to return JSON findings.
- Synthesizer stage receives the reviewers' findings JSON and returns Markdown.

## Safety
- Does not touch your repo (read-only diff). No auto-fixes.
