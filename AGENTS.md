# AGENTS.md

This file is the default operating guide for coding agents working in this repository.

## 1) Mission

Build and maintain Monopoly Deal for web and iOS, with local pass-and-play, practice against bots, live rooms and turn-by-turn rooms, while preserving:
- Rules correctness in `src/engine/`, matched exactly by `apps/ios/DealKit/Sources/DealEngine/`
- The same features and look on both platforms, with cross-play in rooms
- Persistent save/stats compatibility in `src/persistence/`, `src/stats/` and `apps/ios/DealKit/Sources/DealStats/`
- Free hosting: Vercel Blob's monthly limits are tight (see `DECISIONS.md`)

**Several agents may be working at once. Read `docs/PARALLEL_WORK.md` before starting.** `docs/README.md` says which docs are current. Most of `docs/` is historical.

## 2) Fast Start

- Location: `~/Developer/monopolyDeal`, or a worktree beside it. Never under `~/Desktop`, which iCloud offloads.
- Install: `npm ci`
- Dev server: `npm run dev`
- Tests: `npm run test`
- Lint: `npm run lint`
- Build/type-check: `npm run build`
- Everything above: `npm run quality`
- After a rule or bot change: `npm run traces:record`, `npm run replay:verify`
- After an iOS change: `npm run ios:verify -- --skip-ui`, or `npm run ios:verify` with UI tests when no other agent is using the simulator
- After a change to turn-by-turn storage, once deployed: `npm run verify:turn-live`

Always run `npm run test` after logic changes. Run `npm run build` before finishing larger refactors.

## 3) Source Of Truth

- Game rules and legal action generation: `src/engine/game.ts`
- Domain types for engine actions/state: `src/engine/types.ts`
- Card definitions and rent metadata: `src/cards/catalog.ts`
- Browser persistence schema: `src/persistence/storage.ts`
- Stats aggregation/modeling: `src/stats/`
- Primary integration/UI orchestration: `src/App.tsx`
- Room rules: `apps/server/src/gameService.ts`, shared by the live server (`index.ts`, on Render) and turn-by-turn rooms (`turnRooms.ts`, on Vercel)
- Room protocol: `packages/shared/multiplayer.ts`, which only ever gains fields (`packages/shared/PROTOCOL_COMPATIBILITY.md`)
- Rule and behavior decisions: `DECISIONS.md`
- iOS: `apps/ios/README.md`

## 4) Hard Invariants (Do Not Break)

- Turn model:
  - `turn.phase` must progress through draw/action/finished correctly.
  - A player can make at most the ruleset's plays per action phase, 3 by default (`illegal_play_limit` otherwise).
- Pending interactions are exclusive:
  - `state.pending` is a single unresolved interaction at a time (counter/payment/rent/selection flows).
- Hand limit:
  - End turn requires discarding to 7 cards or fewer.
- Win condition:
  - Winner is detected at the ruleset's complete property sets, 3 by default.
  - A set of only any-color Wilds isn't complete. Partial piles of one color rejoin by themselves once nothing is mid-resolution.
- Stats:
  - Only a win by someone on this device counts as a win: `viewerWon` on the match record. Bots' wins never earn anything.
- Hidden information:
  - Room views mask other hands. Only a finished game's replay log shows them.
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
4. Run the checks for what you changed (see Fast Start) and summarize results, including anything not covered.
5. If behavior changed, update whichever docs it makes untrue, and add a `DECISIONS.md` entry for any rule or behavior choice.
6. For a bug, commit a failing test first. Never weaken, skip or delete a test to get a pass.
7. Push, merge or deploy only when asked. A push to `master` goes live.

## 8) Done Criteria

A change is complete when all are true:
- Behavior is correct and consistent with invariants.
- Tests pass locally.
- Types compile (`npm run build`).
- The change exists on both web and iOS, unless the task says otherwise.
- Real screens have been looked at, if the UI changed.
- Any user-visible behavior changes are documented.

## 9) Refactor Safety Protocol (Required)

Use this protocol for any refactor or architecture-leaning change, even if behavior is intended to stay the same.

1. Define behavior contracts before edits:
- List what must remain true (player-visible flows, invariants, error handling).
- Identify where each contract is tested today.
- If untested, add characterization tests first.

2. Keep change batches small and convergent:
- Prefer short-lived branches and phased commits.
- Avoid mixing broad structural refactors with unrelated behavior updates.

3. Prefer stable test shape (pyramid):
- Keep most checks in unit/engine tests.
- Add focused integration/UI tests only for boundary behavior.
- Avoid relying on end-to-end-only validation.

4. Guard high-risk UI changes:
- For card rendering/layout or multiplayer prompts, add/adjust targeted UI tests.
- If behavior cannot be asserted automatically, document a manual verification script in the change summary.

5. Review for code health, not perfection:
- Require evidence that the change improves or preserves code health.
- Block merges that knowingly reduce behavior confidence without a tracked follow-up.

6. Documentation sync is mandatory:
- Update `README.md` and/or `docs/LLM_AGENT_GUIDE.md` whenever workflows, UX, or architecture behavior changes.
- Update active tracker docs when running phased bug-fix programs.

For detailed templates/checklists, see `docs/REFRACTOR_SAFETY_PLAYBOOK.md`.
