# LLM Council Tool — Plan (from Kimi link)

> Source: https://www.kimi.com/share/19c1b91d-b652-822a-8000-0000353515e5?sharetype=link
> 
> Note: copied/summarized locally for easier reference.

## Council configuration (models/roles/cost)

| Stage | Model | Role | Est. cost |
|---|---|---|---|
| Triage | Claude 3.5 Haiku | Quick significance check | ~$0.002/PR |
| Architect | Gemini Pro 2.5 | Design patterns, scalability | ~$0.01–0.03/PR |
| Bug Hunter | Claude Opus 4 | Logic, security, edge cases | ~$0.10–0.25/PR |
| Style | Kimi K2.5 | Idiomatic code, best practices | ~$0.01–0.05/PR |
| Synthesizer | Claude Sonnet 4 | Merge opinions, format output | ~$0.02–0.05/PR |

Total estimate: **~$0.15–0.40 per PR**

## Smart filtering (cost control)

Example logic:

```ts
const shouldReview = (file) => {
  if (file.lines < 10) return false; // Skip trivial
  if (file.path.includes('test')) return false; // Optional
  if (file.extension === 'lock') return false; // Ignore lockfiles
  return true;
};

const DAILY_BUDGET = 2.00; // Hard stop
```

## Implementation phases

### Phase 1: MVP (Week 1) — “Just Works”
- Single model (Claude Sonnet 4) with full repo context
- Comments only (no auto-fixes yet)
- Hardcoded preferences
- Cost: ~ $0.05/PR
- Goal: validate the workflow

### Phase 2: The Council (Weeks 2–3)
- 3-model synthesis
- Confidence scoring
- GitHub “Suggested Changes”
- Cost: ~ $0.25/PR
- Goal: production-ready quality

### Phase 3: Learning Loop (Week 4)
- Accept/reject tracking
- AGENTS.md auto-generation
- Cost monitoring dashboard
- Goal: personalized to user style

### Phase 4: Advanced (future)
- Pre-commit hooks (local review before push)
- VS Code extension
- Fine-tuned small model for specific codebase

## Deliverables

### Immediate next steps
- GitHub Action workflow (production-ready YAML)
- Configuration system (model selection, budget caps)
- Review engine (council logic in TypeScript)
- AGENTS.md generator (interactive CLI for first-time setup)
- Cost tracker (spend logging per PR)

### Key decisions
- Confirm GitHub Actions approach
- Model 4: Kimi K2.5 vs GPT-4o default
- Start with Phase 1 vs jump to full council
- Code style: educational vs optimized production

### Success metrics
- Catches real bugs before production
- Educational value (why, not just what)
- Monthly cost under $20 at expected volume (10 PRs/week)
- Faster than manual code review while maintaining quality
