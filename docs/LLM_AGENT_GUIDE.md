# LLM Agent Guide

Purpose: give coding agents enough context to make correct, low-regression changes without re-learning the whole codebase every run.

## Current Handoff Focus

- Next multiplayer simplification implementation spec:
  - `docs/NEXT_CODEX_MULTIPLAYER.md`

## Architecture Snapshot

- `src/engine/`
  - Pure game rules engine.
  - `src/engine/core.ts` centralizes reusable engine helper utilities (ruleset access, draw/shuffle, payment option generation, property move helpers).
  - Exports: `createGame`, `getLegalActions`, `applyAction`, `isGameOver`, `getNextPrompt`, `getSetCompletionCount`, `getSuggestedPaymentCards`.
- `src/cards/`
  - Card catalog, set sizes, rent scales, display helpers.
- `src/persistence/`
  - `localStorage` read/write wrappers for active game, manual saved slots, stats, and UI preferences.
- `src/stats/`
  - Match record creation, lifetime aggregation, and dev fixture data.
  - Retention helpers (`src/stats/retention.ts`) for achievements and daily challenge progression.
- `src/ai/`
  - Heuristic and rollout decision helpers plus explainable coach hint generation.
- `src/network/`
  - Hosted multiplayer client API wrappers (`src/network/multiplayerClient.ts`) for room create/join/reconnect/start/state/action/leave plus pause/resume/undo/reset-turn/checkpoint flows.
  - In local dev, Vite proxies `/api/multiplayer` to `http://localhost:8787` so LAN clients can use same-origin API calls from the UI host URL.
  - Legacy LAN wrappers remain for development fallback.
- `apps/server/`
  - Multiplayer API server scaffold with room lifecycle, reconnect windows, host migration, revision-guarded mutations, turn snapshots, checkpoints, and best-effort snapshot persistence.
  - Recommended two-device startup command: `npm run dev:lan:all` (LAN UI + multiplayer server).
- `src/ui/` + `src/App.tsx`
  - `App.tsx` owns state/actions and passes typed props to screen containers.
  - `src/app/useFeedback.ts` encapsulates sound/haptic emission.
  - `src/app/useMultiplayerRoom.ts` encapsulates multiplayer room state, actions, polling/reconnect lifecycle, and host/player room controls (pause/undo/checkpoints) plus `Exit Match` (retain reconnect session) vs `Forget Room` (clear session).
  - `src/ui/screens/` contains home/setup/game/stats/settings/post-game screen composition.
  - `src/ui/screens/SavedGamesScreen.tsx` manages manual save slots (load/save-over/rename/delete).
  - `src/ui/layout/` contains shared shell/top bar/action rail primitives.
  - `src/ui/components/ActionConfirmDialog.tsx` handles risky-action confirmation flow.
  - `src/ui/components/RulesDrawer.tsx` provides in-game rules/set/rent quick reference.
  - Selection pending flows now support property-card click interactions for deal actions; keep action-button fallback intact.
  - `src/ui/theme/` contains tokenized CSS split by base/components/screens.

## Data Model Cheat Sheet

### Engine state

`GameState` (`src/engine/types.ts`) contains:
- Turn cursor (`currentPlayerIndex`, `turn.phase`, `turn.playsUsed`)
- Zones (`drawPile`, `discardPile`, player `hand`/`bank`/`properties`)
- Interrupt/interaction state (`pending`)
- Event history (`history`)
- Win marker (`winnerId`)

### Interaction model

`pending` is a tagged union with exactly one unresolved item:
- `counter`
- `payment`
- `rent`
- `sly_deal`
- `forced_deal`
- `deal_breaker`

Do not model multiple simultaneous pending effects.

### Card identity

- Definitions use base ids (`debt_collector`, `brown_1`, etc.).
- Runtime instances are suffixed (`debt_collector#d1`) for uniqueness.
- `getCardDefinition` strips suffix via `split('#')[0]`.

## Rule Boundaries And Invariants

- Turn play budget is capped at 3 plays.
- Passing turn with >7 cards is invalid.
- Win is 3 complete sets.
- `just_say_no` uses counter chain flow (`pending.kind === 'counter'`) before resolving/canceling an effect.
- Multi-target payment (`It's My Birthday`) runs a target chain via `remainingTargetPlayerIds`.
- Buildings (`house`, `hotel`) are treated as non-movable for property steal/swap flows.

## Change Playbooks

### 1) Add or change a rule in the engine

1. Update types first if action/effect shapes changed (`src/engine/types.ts`).
2. Update legal action generation in `legalPlayActions` / `legalForPending`.
3. Update `applyAction` handling and any helper constraints.
4. Ensure event and turn transitions remain consistent.
5. Add/adjust tests in `src/test/engine.test.ts`.

### 2) Add a new action card

1. Extend `ActionKind` in `src/cards/catalog.ts` if new kind.
2. Add card definition entry with `quantity`, value, and rent matrix (if needed).
3. Extend legality generation and resolution in `src/engine/game.ts`.
4. Add tests:
- Action is offered only when valid.
- Action resolves correctly.
- Invalid usage yields stable error behavior.

### 3) Change UI behavior

1. Keep engine as source of truth.
2. Pull legal actions/prompts from engine selectors, not custom ad-hoc UI logic.
3. For high-impact actions, respect `LegalAction.requiresConfirmation` and related metadata.
4. Update component tests (`src/test/*.test.tsx`) when interaction surface changes.

### 4) Change persistence or stats schema

1. Keep v1 readers backward-compatible unless explicit migration is introduced.
2. If schema changes are unavoidable:
- Version the payload.
- Add migration/read fallback logic.
- Document key names and version changes in `README.md`.

## Minimal Test Matrix By Change Type

- Engine rule update:
  - Positive path
  - Invalid path
  - Turn progression
  - Win check
- New pending flow:
  - Flow entry
  - Response/selection handling
  - Flow exit cleanup (`pending = null` when done)
- New card metadata:
  - Definition lookup
  - Legal action visibility
- UI-only change:
  - Rendering + user interaction test

## Regression Prevention System

Use this section when a change risks "silent behavior loss" during refactors.

### A) Behavior Contract Mapping (before coding)

For each touched area, record:
1. User-visible contract (what must still work).
2. Invariant contract (what must still be true internally).
3. Test coverage location.
4. Missing coverage to add before or during refactor.

Suggested contract anchors in this repo:
- Turn progression and pending exclusivity: `src/test/engine.test.ts`
- Multiplayer lifecycle/action legality: `src/test/multiplayer-room-service.test.ts`
- App orchestration and screen transitions: `src/test/app.test.tsx`
- Card visual model/theme assumptions: `src/test/card-ui.test.tsx`

### B) Refactor Change-Set Rules

1. Characterization tests first for previously untested behavior.
2. Structural refactor and behavior change should be separate commits when feasible.
3. Keep branch slices phase-based with tracker updates after each phase.
4. Add explicit rollback notes for risky deltas (what to revert first if regression appears).

### C) Regression Gates (must pass before handoff)

1. `npm run test`
2. `npm run build`
3. `npm run lint` (or document pre-existing warnings)
4. Docs sync:
- user-visible workflow changes reflected in `README.md`
- agent-facing architecture/workflow changes reflected in this guide

### D) UI/Visual Reliability Rule

When card rendering, responsive layout, or modal/prompt orchestration changes:
1. Add/adjust targeted UI tests for the changed contract.
2. Include at least one explicit manual smoke path in the implementation summary.
3. If exact visual fidelity is critical and not captured by tests, log follow-up snapshot coverage work in tracker docs.

## Known Hotspots

- `src/engine/game.ts` is large; regressions are likely when changing shared helpers.
- `src/App.tsx` coordinates many UI states (chooser, payment selection, pass-and-play shield, pause state, settings routing, undo snapshots).
- In multiplayer mode, `GameTableScreen` is reused for active matches; server room state remains authoritative for pause/snapshots/checkpoints.
- Host migration now includes original-host re-preference after reconnect; preserve this when modifying reconnect/migration logic.
- Lobby `Start From Checkpoint` uses checkpoint participant compatibility checks (id + name) before starting from saved state.
- Multiplayer legality matching must treat `pay_request.cards` as order-insensitive to avoid false `illegal_action` rejects for manual payment selection order.
- Multiplayer rules drawer is available in both local and multiplayer game screens; when changing screen gate logic, preserve this parity.
- Growth telemetry uses `monopolyDeal.growthMetrics.v1` and is surfaced in `StatsDashboard`.
- Card rendering/fit is split between `src/ui/components/CardView.tsx`, `src/ui/components/HandFan.tsx`, and `src/ui/theme/components/cards.css`.
- Draw-phase prompt intentionally uses rail hand layout for readability; non-draw prompts still use auto-fit.
- Rent/double-rent/counter interactions are edge-case heavy.

## Milestone Gate Checklist

Use this checklist for feature-milestone commits:

1. Keep each commit cohesive (feature + tests + minimal docs).
2. Do not mix structural refactors with behavioral changes unless required.
3. Run and verify:
- `npm run test`
- `npm run build`
4. Confirm invariant safety:
- Turn phase progression remains valid.
- Single pending interaction model remains intact.
- End-turn hand-limit behavior still enforced.
5. For persistence/stat changes:
- Keep `version: 1` readers backward-compatible.
- Treat new fields as additive + optional defaults.
6. For refactors:
- Confirm behavior contract mapping exists for impacted flows.
- Confirm at least one regression test was added/updated for each bug class fixed.

## Recommended Agent Prompt Template

Use this template when asking an agent to implement changes:

```text
Goal:
- <what to change>

Constraints:
- Preserve turn-phase and pending-flow invariants from AGENTS.md.
- Keep engine as source of truth.
- Do not break localStorage v1 compatibility.

Implementation hints:
- Touch only: <file list>
- Add tests in: <test files>

Validation:
- Run npm run test
- Run npm run build
- Summarize changed behavior + risks
```

## Quick File Map

- Core rules: `src/engine/game.ts`
- Core engine helpers: `src/engine/core.ts`
- Rule and action types: `src/engine/types.ts`
- Card metadata: `src/cards/catalog.ts`
- Save/load: `src/persistence/storage.ts`
- App orchestration hooks: `src/app/useFeedback.ts`, `src/app/useMultiplayerRoom.ts`
- Risky-action confirm modal: `src/ui/components/ActionConfirmDialog.tsx`
- Rules quick reference modal: `src/ui/components/RulesDrawer.tsx`
- Saved slots manager screen: `src/ui/screens/SavedGamesScreen.tsx`
- Match/lifetime models: `src/stats/types.ts`
- Match aggregation: `src/stats/records.ts`
- Dev fixture data: `src/stats/devFixture.ts`
- Main app orchestration: `src/App.tsx`
- AI decision helpers: `src/ai/heuristic.ts`, `src/ai/rollout.ts`, `src/ai/explain.ts`
- Multiplayer screen + client: `src/ui/screens/MultiplayerScreen.tsx`, `src/network/multiplayerClient.ts`
- Multiplayer server entry: `apps/server/src/index.ts`
- Legacy LAN fallback: `src/ui/screens/LanPlayScreen.tsx`, `src/network/lanClient.ts`
- Tests: `src/test/engine.test.ts`, `src/test/app.test.tsx`, `src/test/card-ui.test.tsx`
