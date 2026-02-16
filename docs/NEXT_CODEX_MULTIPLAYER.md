# Next Codex Session: Multiplayer Hosted UX Follow-Through

Purpose: build on shipped multiplayer gameplay parity by reducing onboarding friction for non-technical players.

## Current State (as of latest commits)

- Active multiplayer matches now render the full table experience (`GameTableScreen`) instead of minimal action buttons.
- Host-only room controls exist for pause/resume and checkpoint save/load/delete.
- Active prompt player controls include undo/reset-turn backed by server-authoritative snapshots.
- Multiplayer mutations are revision-guarded to reduce stale write conflicts.
- LAN startup is simplified for non-technical testing via `npm run dev:lan:all` with Vite proxying `/api/multiplayer` to the local API server.
- Multiplayer lobby includes `Copy Room Code` to reduce manual code-sharing friction.
- Same-machine local development still supports one-command startup via `npm run dev:all`.

## Next Objective

Ship invite-link and deep-link join flow so non-technical players can open a URL and join directly with minimal manual entry.

## Required Outcomes

1. Host can share an invite link from the multiplayer lobby.
2. Opening `/join/:roomCode` routes directly into multiplayer join flow.
3. Join code is auto-filled from URL path.
4. Production copy remains non-technical while preserving dev diagnostics in dev only.
5. Existing parity features (pause/checkpoints/undo/reset/reconnect) remain stable.

## Implementation Scope

### 1) Invite Link Flow

- Add canonical join route format: `/join/:roomCode`.
- On host room creation, render:
  - `Copy Room Code`
  - `Copy Invite Link`
- Invite link target:
  - `window.location.origin + /join/<ROOM_CODE>`

### 2) Deep-Link Join Behavior

- On app load, detect `/join/:roomCode`.
- Auto-route to multiplayer screen.
- Pre-fill join code from route.
- Keep player name editable before submit.

### 3) Production-First Messaging

- Keep local diagnostics dev-only:
  - API base helper line
  - `npm run dev:all` guidance
- Keep production copy simple and non-technical.

### 4) Documentation Follow-Through

- Update README with hosted invite-link quick start.
- Update release notes with deep-link join behavior.
- Keep LLM guide aligned with route and flow changes.

## Suggested File Touch List

- `src/App.tsx`
- `src/ui/screens/MultiplayerScreen.tsx`
- `src/app/useMultiplayerRoom.ts`
- `src/network/multiplayerClient.ts` (if helper changes are needed)
- `src/test/app.test.tsx`
- `README.md`
- `docs/FEATURE_RELEASE_NOTES.md`

## Test Requirements

Automated:

1. Navigating directly to `/join/:roomCode` opens multiplayer join UI with prefilled code.
2. Host sees invite-link copy control after room creation.
3. Production copy excludes local troubleshooting details.
4. Existing multiplayer parity tests continue to pass.

Verification commands:

1. `npm run test`
2. `npm run build`
3. `npm run lint` (allow existing known warning only)

## Manual Acceptance Script

1. Host opens app and taps `Play Multiplayer`.
2. Host taps `Host Multiplayer Game`.
3. Host taps `Copy Invite Link` and sends it.
4. Player 2 opens link on another laptop/phone.
5. App opens multiplayer join flow with code already filled.
6. Player 2 enters name and joins.
7. Host starts match and parity controls still function.

## Non-Goals (for this next session)

- Matchmaking/lobbies beyond private invites.
- Accounts/authentication.
- Websocket transport migration (still deferred from parity release).

## Definition of Done

- Invite-link flow implemented and tested.
- Deep-link join route works from a clean browser session.
- Docs updated and consistent with shipped behavior.
- No regressions to existing multiplayer parity controls.
