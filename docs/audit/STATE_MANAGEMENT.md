# State Management Audit

## Global state ownership

- `src/App.tsx` is the primary state owner for local gameplay, routing, and feature toggles.
- Multiplayer session/room lifecycle state is encapsulated in `useMultiplayerRoom` (`src/app/useMultiplayerRoom.ts`).
- Engine `GameState` remains the game source of truth (`src/engine/types.ts`).

## Derived state usage

- Legal actions and prompts are derived via engine selectors (`getLegalActions`, `getNextPrompt`).
- UI-only derivations are memoized in `App.tsx` and `GameTableScreen.tsx`.
- Payment/selection state is UI-owned and reconciled against pending engine interactions.

## UI state domains

- Screen and navigation state: `src/App.tsx`.
- Multiplayer chat/surface state: `src/App.tsx` + `src/ui/components/MultiplayerChatDock.tsx`.
- Table interaction state (chooser, selected cards, overlays): `src/App.tsx` and props into `src/ui/screens/GameTableScreen.tsx`.

## Hazards and mitigation

- Duplicated truth risk:
  - Engine truth + UI helper state can drift if action handlers bypass engine-derived legal actions.
  - Mitigation: keep actions sourced from engine legal action lists.
- Re-render storm risk:
  - Large prop fan-out from `App.tsx`.
  - Mitigation: memoized derived actions/prompts and focused hook extraction.
- Multiplayer stale-response risk:
  - Async responses can race with local session clearing.
  - Mitigation: operation versioning in `useMultiplayerRoom`.

## Cross-links

- `src/App.tsx`
- `src/app/useMultiplayerRoom.ts`
- `src/engine/game.ts`
- `docs/LLM_AGENT_GUIDE.md`
