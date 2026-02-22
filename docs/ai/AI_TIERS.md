# AI Tiers

## Tier 1 — Heuristic (current)

- Fast score-based ranking of legal commands.
- Prioritizes set progress, leverage actions, and efficient payments.
- Best for default casual AI.

## Tier 2 — Weighted strategy (current baseline shape)

- Heuristic scoring with tunable priorities.
- Difficulty knobs can tune aggression, safety, and disruption preference.

## Tier 3 — Monte Carlo rollout (current)

- Simulates future branches with deterministic RNG.
- Computes expected-value style score from rollouts.
- Higher compute cost; suitable for hard mode.

## Tier 4 — Adaptive (future)

- Opponent tendency adaptation from recorded history while preserving reproducibility constraints.
- Requires explicit deterministic adaptation policy and bounded memory model.

## Performance constraints

- Rollout simulation counts and depth must remain bounded for UI responsiveness.
- Hard-mode defaults should avoid blocking turn flow.

## Test requirements

- AI output is always a legal engine command.
- Fixed seed produces repeatable rollout decisions.
- Coach hints resolve to actionable legal choices.

## Verification references

- Contract and legality coverage: `src/test/ai-contract.test.ts`
- Tier/scenario deterministic matrix: `src/test/ai-tier-matrix.test.ts`
- Engine determinism baseline: `src/test/determinism.test.ts`
- Replay compatibility baseline: `src/test/replay.test.ts`
- Difficulty verification guide: `docs/ai/AI_DIFFICULTY_VERIFICATION_MATRIX.md`
