# Separation of Concerns and Event/Data Flow

## Boundaries

- Engine domain:
  - State transitions, legal action generation, prompt derivation
  - Files: `src/engine/*`
- UI domain:
  - Screen and interaction rendering only
  - Files: `src/ui/*`, `src/App.tsx`
- Adapter domain:
  - Network transport and persistence operations
  - Files: `src/network/*`, `src/persistence/*`, `apps/server/src/*`

## Event flow (local)

1. UI requests legal actions from engine.
2. User selects action.
3. Action applied by engine (`applyAction`).
4. Engine emits `events` and next state.
5. UI renders from state/events.

## Event flow (multiplayer)

1. UI submits command via client adapter.
2. Server validates session + revision and applies command.
3. Server updates room revision and broadcasts event envelope.
4. Client receives SSE update and refreshes room snapshot.

## Suspected race-risk areas

- Push update + polling refresh overlap in `useMultiplayerRoom`.
- Session clear operations racing with in-flight async callbacks.
- UI copy-notice and LAN-origin resolution timing on localhost invite flow.
- Revision conflict handling consistency across all mutating client actions.

## Current race mitigations

- Operation version guard in `useMultiplayerRoom` prevents stale async writes.
- Last-event ID dedupe for SSE updates.
- Revision conflict guard (`expectedRevision`) on server mutations.

## Next-stage hardening targets

- Centralize client mutation error handling paths.
- Add regression tests for reconnect + revision-conflict loops.
