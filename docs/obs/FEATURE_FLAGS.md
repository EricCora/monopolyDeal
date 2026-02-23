# Feature Flags and Runtime Controls

## Current flag surfaces

- UI experimental toggles in persisted preferences:
  - AI opponents / AI coach
  - replay timeline
  - daily challenges
  - achievements
  - custom rules
  - multiplayer push and reactions
- Server env flags:
  - `MULTIPLAYER_SOCKET_ENABLED`
  - `MULTIPLAYER_PUSH_ENABLED`
  - `MULTIPLAYER_REACTIONS_ENABLED`
  - `MP_RECONNECT_GRACE_MS`
- Client env flags:
  - `VITE_MULTIPLAYER_SOCKET_ENABLED`
  - `VITE_MULTIPLAYER_PUSH_ENABLED`
  - `VITE_MULTIPLAYER_REACTIONS_ENABLED`
  - `VITE_MP_RECONNECT_DEBUG`

## Always-on Multiplayer Policies

The following multiplayer hardening features are graduated and no longer rollout-gated:

- reconnect handshake + authoritative snapshot resync
- bounded reconnect retry/backoff loop
- stale-action rejection + auto-resync recovery
- disconnect pause/resume runtime policy + host-timeout room ending
- reconnect UI-state scaffolding (handshake/resync/terminal states)
- Socket.IO-first transport policy with SSE/HTTP fallback

## Debug visibility

- `VITE_MP_RECONNECT_DEBUG=false` keeps the detailed reconnect diagnostics panel off by default.
- In local/dev context, multiplayer screens always show policy status and live-update/runtime state chips.

## Rollout hygiene

1. New risky features should still launch behind explicit flags.
2. Remove stale flags once behavior is graduated.
3. Keep each remaining flag mapped to a concrete fallback behavior.

Current emergency transport fallback:

- Set `MULTIPLAYER_SOCKET_ENABLED=false` and/or `VITE_MULTIPLAYER_SOCKET_ENABLED=false` to force HTTP/SSE-only behavior during incident mitigation.
