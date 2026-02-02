# Architecture

## Core idea
Run multiple specialized "reviewers" (models/roles) on the same change set, then merge their findings with a synthesizer.

## Modules
- `src/council/`
  - `stages.ts` — stage definitions (role, model, params)
  - `pipeline.ts` — orchestration: run stages, enforce budgets, gather outputs
  - `scoring.ts` — confidence scoring and deduping
- `src/lib/`
  - `openai.ts` — OpenAI adapter (Responses API)
  - `prompt.ts` — prompt builders per role
  - `diff.ts` — diff extraction utilities
- `src/storage/`
  - `events.ts` — event types
  - `jsonl.ts` — append-only local logs
- `src/cli/`
  - `review.ts` — local runner
  - `feedback.ts` — record accept/reject
  - `agents-gen.ts` — generate AGENTS.md from learned prefs

## Outputs
- Human-facing: Markdown report
- Machine-facing: JSON artifact (all stage outputs + costs + selected suggestions)

## Safety
- Never modifies target repos by default.
- Any auto-fix features must be opt-in, and only via explicit "apply" command.
