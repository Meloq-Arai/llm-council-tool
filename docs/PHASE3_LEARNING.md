# Phase 3 — Learning Loop (implemented locally)

## Files
- Feedback log (default): `data/feedback.jsonl` (append-only)
- Generated preferences: `AGENTS.md`

## Record feedback

```bash
npm run build
npm run feedback -- --suggestion "bug_hunter:some-id:1" --accept --note "Prefer early returns"
npm run feedback -- --suggestion "style:some-id:2" --reject --note "Avoid changing formatting unless necessary"
```

## Generate AGENTS.md

```bash
npm run build
npm run agents:gen -- --feedback "./data/feedback.jsonl" --out "./AGENTS.md"
```

## Notes
This is intentionally simple and safe: it only stores minimal feedback events locally.
