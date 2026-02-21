# Multiplayer Audit

## Current architecture

- Authority: server-authoritative room lifecycle in `apps/server/src/gameService.ts`.
- API transport: HTTP JSON endpoints + SSE room update stream (`apps/server/src/index.ts`).
- Client orchestration: `src/app/useMultiplayerRoom.ts`.

## Sync model

- State pull: `/state` returns full `MultiplayerRoomView`.
- Push hint: SSE `room_update` envelope with `eventId` and `revision`.
- Fallback: client polling remains active.

## Reconnect flow

- Session persisted locally (`monopolyDeal.multiplayerSession.v1`).
- Auto-reconnect on app load.
- Expired/missing room triggers recovery notice and local session clear.

## Failure modes

- Revision conflict on stale mutation (`revision_conflict`).
- Session mismatch or expiration (`invalid_session`, `reconnect_expired`).
- Room lifecycle terminal errors (`room_not_found`, `room_started` in join context).

## Hardening updates in this stage

- Added client reconnect single-flight guard to avoid overlapping reconnect attempts (`src/app/useMultiplayerRoom.ts`).
- Added stricter server payload boundaries for session, revision, and action-shape validation (`apps/server/src/index.ts`, `apps/server/src/validation.ts`).
- Added request-validation regression tests (`src/test/server-validation.test.ts`).
- Added broader client-side revision-conflict refresh behavior in mutation paths.
- Added server-room regression test ensuring stale revision action attempts do not mutate room state.

## Remaining hardening targets

- Optional: run a real-device network chaos pass (offline/online toggles) to complement automated tests.
- Add explicit protocol-compatibility checks between shared and client type surfaces.
