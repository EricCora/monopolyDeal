# Multiplayer Audit

## Current architecture

- Authority: server-authoritative room lifecycle in `apps/server/src/gameService.ts`.
- API transport: Socket.IO command/event transport (primary) with HTTP JSON + SSE fallback (`apps/server/src/index.ts`).
- Client orchestration: `src/app/useMultiplayerRoom.ts`.

## Sync model

- State pull: `/state` returns full `MultiplayerRoomView`.
- Push hint: Socket.IO `room_update` envelope with `eventId` and `revision` (SSE fallback).
- Fallback: client polling remains active.
- Outage behavior: client enters a short socket cooldown after transport failure, uses HTTP fallback immediately during cooldown, then probes socket-primary again.

## Reconnect flow

- Session persisted locally (`monopolyDeal.multiplayerSession.v1`).
- Auto-reconnect on app load with bounded retry/backoff.
- Expired/missing room triggers recovery notice and local session clear.
- Successful reconnect handshake returns explicit status and authoritative snapshot payload.
- Client applies snapshot immediately and uses `/state` only as compatibility fallback.

## Failure modes

- Revision conflict on stale mutation (`revision_conflict`).
- Session mismatch or expiration (`invalid_session`, `reconnect_expired`).
- Room lifecycle terminal errors (`room_not_found`, `room_started` in join context).
- Structured action rejection for guarded stale writes (`action_rejected` with reason taxonomy).
- Push bootstrap timeout (socket or SSE) degrades to polling without blocking gameplay.

## Runtime disconnect policy (MD-C10)

- Match rooms pause on disconnect with explicit runtime state markers.
- Host disconnect uses host-specific pause semantics.
- Host timeout transitions room to `ended_timeout` (no host migration after match start).
- Lobby host migration remains allowed only before match start.

## Hardening updates in this stage

- Added client reconnect single-flight guard + bounded retry loop (`src/app/useMultiplayerRoom.ts`).
- Added explicit reconnect handshake status contract and snapshot resync path (`apps/server/src/index.ts`, `src/app/useMultiplayerRoom.ts`).
- Added stricter server payload boundaries for session, revision, and action-shape validation (`apps/server/src/index.ts`, `apps/server/src/validation.ts`).
- Added request-validation regression tests (`src/test/server-validation.test.ts`).
- Added stale-action rejection + auto-resync path with always-on version guarding.
- Added server-room regression tests for host disconnect runtime policy and stale-action idempotency.
- Added immediate stream bootstrap (`reason=stream_bootstrap`) and socket cooldown fallback to reduce false live-update degradation and command lag in LAN/dev paths.

## Stage-4 closure notes

- Reconnect/resync contract, transport fallbacks, pause/end runtime policy, and stale-action recovery are now covered by service/hook/screen/app tests.
- Core reconnect/version/disconnect policies are now always-on; feature flags remain only for push/reactions and optional reconnect debug panel.
- Remaining roadmap work shifts to AI matrix verification and final closure artifacts (Stages 5/6).
