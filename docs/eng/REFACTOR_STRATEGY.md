# Refactor Strategy

## Principles

- Preserve behavior first; extract structure second.
- Keep changes small and test-backed.
- Avoid coupling refactors with unrelated feature work.

## Extraction seams

1. Engine command validation helpers from `src/engine/game.ts`.
2. Multiplayer lifecycle/mutation error handling from `src/app/useMultiplayerRoom.ts`.
3. App orchestration grouping in `src/App.tsx` for local vs multiplayer turn flows.

## Safe sequence

1. Characterize current behavior with tests.
2. Extract pure helper(s) behind unchanged public API.
3. Re-run replay fingerprint and full quality gates.
4. Update docs and tracker in same change set.

## Non-goals

- No engine API break by default.
- No persistence schema break without explicit migration ADR.
