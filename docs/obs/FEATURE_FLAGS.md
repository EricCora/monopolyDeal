# Feature Flags and Experiments

## Current flag surfaces

- UI experimental toggles in persisted preferences:
  - AI opponents / AI coach
  - replay timeline
  - daily challenges
  - achievements
  - custom rules
  - multiplayer push and reactions
- Server env flags:
  - `MULTIPLAYER_PUSH_ENABLED`
  - `MULTIPLAYER_REACTIONS_ENABLED`
  - `MP_RECONNECT_V1`
  - `MP_RECONNECT_GRACE_MS`
  - `MP_VERSION_GUARD_V1`
- Client env flags:
  - `VITE_MP_RECONNECT_V1`
  - `VITE_MP_RECONNECT_V1_UI`
  - `VITE_MP_VERSION_GUARD_V1`

## Rollout rules

1. Default new risky features to off.
2. Keep additive preference schema changes backward-compatible.
3. Pair each flag with clear user-facing fallback behavior.
4. Remove stale flags after stable graduation.

## Experiment hygiene

- Record metrics for enablement and key outcomes.
- Avoid flag interdependencies that create invalid combinations.
