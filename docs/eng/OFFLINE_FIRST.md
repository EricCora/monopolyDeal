# Offline-First (Stretch)

Status: optional future enhancement.

## Potential scope

- Cache static assets for quick reload resilience.
- Preserve local pass-and-play and saved-game access offline.
- Degrade multiplayer surfaces gracefully when network unavailable.

## Proposed approach

1. Introduce service worker via Vite-compatible plugin.
2. Cache app shell and static assets.
3. Keep local storage persistence as primary local state source.
4. Show explicit offline banner and multiplayer-disabled messaging.

## Risks

- Cache invalidation complexity.
- Additional test matrix for online/offline transitions.
- Potential stale-client mismatch for multiplayer entry points.
