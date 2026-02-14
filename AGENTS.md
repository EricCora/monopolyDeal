# AGENTS.md

This file is the default operating guide for coding agents working in this repository.

## 1) Mission

Build and maintain a local, pass-and-play Monopoly Deal web app while preserving:
- Rules correctness in `src/engine/`
- UI clarity in `src/App.tsx` + `src/ui/components/`
- Persistent save/stats compatibility in `src/persistence/` and `src/stats/`

## 2) Fast Start

- Install: `npm install`
- Dev server: `npm run dev`
- Tests: `npm run test`
- Lint: `npm run lint`
- Build/type-check: `npm run build`

Always run `npm run test` after logic changes. Run `npm run build` before finishing larger refactors.

## 3) Source Of Truth

- Game rules and legal action generation: `src/engine/game.ts`
- Domain types for engine actions/state: `src/engine/types.ts`
- Card definitions and rent metadata: `src/cards/catalog.ts`
- Browser persistence schema: `src/persistence/storage.ts`
- Stats aggregation/modeling: `src/stats/`
- Primary integration/UI orchestration: `src/App.tsx`

## 4) Hard Invariants (Do Not Break)

- Turn model:
  - `turn.phase` must progress through draw/action/finished correctly.
  - A player can make at most 3 plays per action phase (`illegal_play_limit` otherwise).
- Pending interactions are exclusive:
  - `state.pending` is a single unresolved interaction at a time (counter/payment/rent/selection flows).
- Hand limit:
  - End turn requires discarding to 7 cards or fewer.
- Win condition:
  - Winner is detected at 3 complete property sets.
- Card instance identity:
  - Runtime cards use instance ids like `card_base_id#uniqueSuffix`; base ids map to `CARD_DEFINITIONS`.
- Persistence compatibility:
  - Keep `version: 1` structures readable unless intentionally migrating.

## 5) Implementation Rules

- Prefer changing engine logic first, then adapt UI/legal action presentation.
- If you add new `Action` variants or pending effect kinds:
  - Update union types in `src/engine/types.ts`
  - Update legal action generation
  - Update `applyAction` resolution paths
  - Add engine tests covering happy path + invalid path
- Keep pure logic in engine/stats modules; avoid burying rules in React components.
- For save-format changes, support old snapshots or perform explicit migration.

## 6) Testing Expectations

Minimum for logic changes:
- `src/test/engine.test.ts` for rule/flow behavior
- Targeted UI test only when rendering/interaction behavior changes (`src/test/*.test.tsx`)

Recommended cases for each rule change:
- Legal action appears when allowed
- Legal action is absent when disallowed
- Action application mutates state correctly
- Error code returned for invalid use
- End-of-turn and winner behavior still correct

## 7) Agent Workflow

1. Read impacted modules and nearby tests.
2. State assumptions in your task notes/PR description.
3. Make smallest coherent patch.
4. Run tests (`npm run test`) and summarize results.
5. If behavior changed, update docs in `README.md` or `docs/LLM_AGENT_GUIDE.md`.

## 8) Done Criteria

A change is complete when all are true:
- Behavior is correct and consistent with invariants.
- Tests pass locally.
- Types compile (`npm run build`).
- Any user-visible behavior changes are documented.
