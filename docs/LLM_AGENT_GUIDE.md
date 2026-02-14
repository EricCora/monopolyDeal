# LLM Agent Guide

Purpose: give coding agents enough context to make correct, low-regression changes without re-learning the whole codebase every run.

## Architecture Snapshot

- `src/engine/`
  - Pure game rules engine.
  - Exports: `createGame`, `getLegalActions`, `applyAction`, `isGameOver`, `getNextPrompt`, `getSetCompletionCount`.
- `src/cards/`
  - Card catalog, set sizes, rent scales, display helpers.
- `src/persistence/`
  - `localStorage` read/write wrappers for active game and stats.
- `src/stats/`
  - Match record creation and lifetime aggregation.
- `src/ui/` + `src/App.tsx`
  - `App.tsx` owns state/actions and passes typed props to screen containers.
  - `src/ui/screens/` contains home/setup/game/stats/post-game screen composition.
  - `src/ui/layout/` contains shared shell/top bar/action rail primitives.
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
3. Update component tests (`src/test/*.test.tsx`) when interaction surface changes.

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

## Known Hotspots

- `src/engine/game.ts` is large; regressions are likely when changing shared helpers.
- `src/App.tsx` coordinates many UI states (chooser, payment selection, pass-and-play shield, undo snapshots).
- Rent/double-rent/counter interactions are edge-case heavy.

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
- Rule and action types: `src/engine/types.ts`
- Card metadata: `src/cards/catalog.ts`
- Save/load: `src/persistence/storage.ts`
- Match/lifetime models: `src/stats/types.ts`
- Match aggregation: `src/stats/records.ts`
- Main app orchestration: `src/App.tsx`
- Tests: `src/test/engine.test.ts`, `src/test/app.test.tsx`, `src/test/card-ui.test.tsx`
