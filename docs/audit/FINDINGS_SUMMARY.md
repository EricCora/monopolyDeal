# Findings Summary

## Strengths

- Pure rules-engine boundary with deterministic seed support.
- Mature multiplayer server-authoritative flow with revision guards and reconnect windows.
- Strong existing test coverage across engine, app, storage, and multiplayer service paths.
- Tokenized UI theming and improved in-match clarity already present.

## Technical debt

- Large high-risk files:
  - `src/engine/game.ts:512` (`applyAction` branch density)
  - `src/App.tsx:242` (orchestration breadth)
  - `src/app/useMultiplayerRoom.ts:351` (multiplayer lifecycle complexity)
- Dual protocol type surfaces (`packages/shared/multiplayer.ts` and `src/network/multiplayerTypes.ts`) can drift.

## Severity-ordered risks

1. **High** — Engine branch complexity can hide regression during rule edits.
- File: `src/engine/game.ts:512`
- Impact: invalid legal action exposure, pending-flow breakage, winner/turn regressions.

2. **High** — App-level orchestration and prop fan-out increase UI state coupling risk.
- File: `src/App.tsx:242`
- Impact: prompt/selection/payment UI drift from engine state.

3. **Medium** — Multiplayer async race windows around reconnect/refresh sequences.
- File: `src/app/useMultiplayerRoom.ts:351`
- Impact: stale status, user confusion, unnecessary reconnect churn.

4. **Medium** — Protocol duplication can introduce wire-contract mismatches over time.
- Files: `packages/shared/multiplayer.ts:1`, `src/network/multiplayerTypes.ts:1`
- Impact: runtime parsing/typing divergence between server and client.

5. **Low** — Lint warning in stats dashboard indicates compiler memoization skip.
- File: `src/ui/components/StatsDashboard.tsx:117`
- Impact: mostly perf/maintainability signal, not current correctness blocker.

## Scalability limits (current)

- `applyAction` growth pressure as new cards/rules are added.
- `App.tsx` complexity pressure as UI and multiplayer features expand.
- Snapshot-style room refresh model is robust but chatty under high-frequency action bursts.

## Recommended immediate focus

- Continue staged decomposition around engine and multiplayer lifecycle helpers.
- Keep tests ahead of rule-flow changes.
- Add replay hash verification and deterministic regression tests.
