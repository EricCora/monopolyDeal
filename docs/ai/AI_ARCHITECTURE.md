# AI Architecture

## Contract

AI must consume engine state and emit engine commands only.

- Input: `GameState`, active `playerId`, legal command list.
- Output: one command from legal action candidates.
- No direct UI mutation or adapter side effects in AI modules.

## Current modules

- Heuristic ranking/selection: `src/ai/heuristic.ts`
- Rollout (Monte Carlo style): `src/ai/rollout.ts`
- Coach explanation layer: `src/ai/explain.ts`

## Determinism

- Rollout path accepts explicit seed and produces deterministic result for fixed seed/state/legal list.
- Engine command execution remains deterministic under seeded game initialization.

## Integration boundary

- App bot turn execution: `src/App.tsx`
- Coach hint generation in render flow: `buildCoachHint(...)`

## Guardrails

- AI may not bypass engine legality checks.
- AI outputs should be validated by legal-action membership before execution.
- AI behavior regressions require deterministic tests.
