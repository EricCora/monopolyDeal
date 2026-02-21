# Networking Audit

## Transport

- Request/response: HTTP JSON endpoints (`apps/server/src/index.ts`).
- Live room updates: Server-Sent Events endpoint `/events` with polling fallback.

## Authority model

- Server-authoritative room model.
- Clients submit commands; server validates session, revision, and action legality before mutating room state.

## Message/data shape

- Shared room/session/protocol contracts in `packages/shared/multiplayer.ts`.
- Client-side mirror types in `src/network/multiplayerTypes.ts`.
- Command channel includes `expectedRevision` for conflict detection.

## Sync model

- Primary: SSE `room_update` envelope with `revision`/`eventId`.
- Secondary: periodic polling refresh in `useMultiplayerRoom`.
- Room state pulls are full room-view snapshots (`/state`), not patch streams.

## Reconnect and recovery

- Reconnect window tracked per participant on server.
- Client auto-reconnect bootstrap from persisted session.
- Expired or missing room sessions are auto-cleared with recovery notice.

## Latency and integrity handling

- Revision conflicts return explicit error (`revision_conflict`).
- Client retries/refreshes state on reconnect loop.
- Leave, start, action, pause/resume all support expected-revision guards.

## Gaps to harden in later stage

- Keep shared/client protocol definitions synchronized via explicit compatibility notes/tests.
- Expand desync/revision conflict integration tests around high-frequency mutation paths.
