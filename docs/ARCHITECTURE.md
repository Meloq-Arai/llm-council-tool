# Architecture

## Core idea
Run multiple specialized "reviewers" (models/roles) on the same change set, then merge their findings with a synthesizer.

## Modules
- `src/council/`
  - `stages.ts` — stage definitions (role, model, params)
  - `pipeline.ts` — orchestration: run stages, enforce budgets, gather outputs
  - `scoring.ts` — confidence scoring and deduping
- `src/lib/`
  - `openai.ts` — OpenAI adapter (Responses API) + retries + timeouts
  - `prompt.ts` — prompt builders
  - `role-prompts.ts` — per-role JSON-only prompts for council stages
  - `diff.ts` — diff extraction utilities (git)
  - `diff-pack.ts` — diff splitting/filtering/packing under budgets
- `src/storage/`
  - `jsonl.ts` — append-only local logs
- `src/cli/`
  - `runner.ts` — local single-reviewer runner
  - `council.ts` — local council runner
  - `feedback.ts` — record accept/reject
  - `agents-gen.ts` — generate AGENTS.md from learned prefs

## Outputs
- Human-facing: Markdown report
- Machine-facing: JSON artifact (all stage outputs + costs + selected suggestions)

## Safety
- Never modifies target repos by default.
- Any auto-fix features must be opt-in, and only via explicit "apply" command.
