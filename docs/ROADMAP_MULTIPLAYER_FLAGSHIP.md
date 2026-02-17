# Multiplayer Flagship Roadmap

Purpose: make multiplayer feel seamless, social, and premium while keeping changes reversible.

## Program Goals

1. Frictionless reliability (join, reconnect, host migration clarity)
2. Social energy (ready checks, quick reactions, room activity feed)
3. Premium presentation (clear multiplayer hierarchy and connection affordances)
4. Operational confidence (feature flags, telemetry, tests, and rollback paths)

## Current Delivery Scope (Implemented)

- Invite/deep-link onboarding
  - Canonical join route: `/join/:roomCode`
  - Lobby `Copy Invite Link` action (`<origin>/join/<ROOM_CODE>`)
  - Deep-link open auto-routes to Multiplayer and pre-fills join code
- Hybrid push backbone
  - Server push endpoint: `GET /api/multiplayer/rooms/:roomCode/events`
  - Event envelope includes revision/event id/reason/server time
  - Client subscribes to push updates and refreshes room state immediately
  - Polling remains active as fallback heartbeat
- Social lobby/match enhancements
  - Lobby-ready state per player (`POST /ready`)
  - Quick preset reactions (`POST /reaction`)
  - Activity feed in lobby and in-match HUD
  - Host migration visibility through activity feed + in-match notice
- Reliability UX
  - Multiplayer reconnect/disconnect overlay in active table view
  - Push status surfaced in lobby (`live`, `fallback`, `unsupported`, `disabled`)
- Feature flags and telemetry
  - UI flags: `multiplayerPushEnabled`, `multiplayerReactionsEnabled`
  - Server flags: `MULTIPLAYER_PUSH_ENABLED`, `MULTIPLAYER_REACTIONS_ENABLED`
  - Added multiplayer funnel + push health growth metrics

## Acceptance Criteria

1. Opening `/join/:roomCode` goes directly to Multiplayer with code prefilled.
2. Host can copy and share invite links from the lobby.
3. Room updates feel immediate when push works and remain stable with polling fallback.
4. Ready states, reactions, and activity feed are visible in lobby and in-match surfaces.
5. Host migration and reconnect states are clearly communicated in UI.
6. All changes are covered by tests, build cleanly, and are documented.

## Out Of Scope For This Phase

- Full WebSocket migration replacing all REST mutations
- Accounts/friends graph/authentication
- Public matchmaking queue and global room discovery

## Verification Standard

- `npm run test`
- `npm run build`
- `npm run lint` (known existing warning in `src/ui/components/StatsDashboard.tsx`)

## Rollback Strategy

- Disable push updates via UI feature flag and/or `MULTIPLAYER_PUSH_ENABLED=false`
- Disable reactions via UI feature flag and/or `MULTIPLAYER_REACTIONS_ENABLED=false`
- Keep REST mutation path and polling refresh as stable baseline
