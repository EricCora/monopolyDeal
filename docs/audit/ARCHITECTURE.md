# Architecture Snapshot

## Pattern summary

- UI: component-driven React screens/components (`src/ui/*`) orchestrated by `src/App.tsx`.
- Domain engine: pure rules core in `src/engine/*`.
- Side effects: isolated to hooks/network/persistence (`src/app/*`, `src/network/*`, `src/persistence/*`).
- Multiplayer authority: server-authoritative room service (`apps/server/src/gameService.ts`, `apps/server/src/index.ts`).

## Runtime flow (local)

```text
UI interaction
  -> App selects legal actions from engine
  -> user chooses action
  -> applyAction(state, action)
  -> next state + events
  -> UI renders from next state/events
```

## Runtime flow (multiplayer)

```text
UI interaction
  -> client sends command payload to server
  -> server validates session/revision + applies room action
  -> server increments revision and emits SSE room_update event
  -> client refreshes room state and rerenders
```

## Layer boundaries

- Engine boundary:
  - Entry points: `createGame`, `getLegalActions`, `applyAction`, `getNextPrompt`
  - Files: `src/engine/game.ts`, `src/engine/types.ts`
- UI boundary:
  - Screen composition: `src/ui/screens/*`
  - Shared components: `src/ui/components/*`
- Adapter boundary:
  - Multiplayer client: `src/network/multiplayerClient.ts`
  - Persistence: `src/persistence/storage.ts`
  - Server adapters: `apps/server/src/index.ts`

## Architectural strengths

- Rules logic centralized in one engine boundary.
- Shared protocol types are explicit in `packages/shared/multiplayer.ts`.
- Multiplayer revision checks and reconnect windows are first-class.

## Architectural pressure points

- Large orchestrator modules (`src/App.tsx`, `src/engine/game.ts`) increase regression risk.
- Client and server multiplayer types are duplicated (`src/network/multiplayerTypes.ts` + `packages/shared/multiplayer.ts`) and need drift checks.
