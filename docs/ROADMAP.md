# Roadmap — LLM Council Tool

Source plan: `PLAN.md`

This repo is being built locally-first (no GitHub wiring required until later).

## Phase 2 — The Council (weeks 2–3)
Goal: multi-model review + synthesis with confidence scoring.

Deliverables:
- Council pipeline (N reviewers + synthesizer)
- Cost controls (file filtering + daily/run budget)
- Output format v1 (Markdown + JSON artifact)

## Phase 3 — Learning Loop (week 4)
Goal: learn preferences from accept/reject feedback.

Deliverables:
- Feedback capture format (accepted/rejected suggestions)
- Aggregation into style rules
- AGENTS.md generator (seed + updates)
- Cost tracking dashboard/logs

## Phase 4 — Advanced (future)
Goal: developer UX.

Deliverables:
- Local pre-commit / pre-push hook runner
- Optional VS Code integration (out of scope for now; stub design)
- Optional small model specialization (out of scope; document extension points)
