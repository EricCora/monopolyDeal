# Next Codex Session: Multiplayer Simplification

Purpose: make multiplayer feel consumer-grade for non-technical users (no terminal/IP steps for players).

## Current State (as of latest commits)

- One-click multiplayer UI exists in app (`Play Multiplayer`, room code flow).
- Local dev is simpler (`npm run dev:all`) and now auto-opens browser.
- Localhost API fallback and actionable unreachable messaging are fixed.
- Multiplayer server startup/runtime import issues are fixed for local development.

## Next Objective

Ship an invite-link, hosted-first multiplayer experience so two non-technical users can play by opening a URL and entering a name.

## Required Outcomes

1. No terminal steps for player 2.
2. Host can share one invite link (not just a room code).
3. Join page auto-fills room code from URL.
4. Production users do not see local-dev troubleshooting text.
5. Local development flow remains available for contributors.

## Implementation Scope

### 1) Invite Link Flow

- Add a canonical join route format: `/join/:roomCode`.
- On host success, render:
  - `Copy Room Code`
  - `Copy Invite Link`
- Invite link target:
  - `window.location.origin + /join/<ROOM_CODE>`

### 2) Deep-Link Join Behavior

- On app load, detect if path matches `/join/:roomCode`.
- Auto-route to multiplayer screen.
- Auto-populate join code from URL segment.
- Keep player name editable before join action.

### 3) Production-First Multiplayer UX

- Keep local diagnostics dev-only:
  - API base helper line
  - `npm run dev:all` guidance
- Production copy should be simple:
  - “Create or join with a private room code.”
  - concise retry messaging without technical details.

### 4) Deployment Readiness Docs

- Add a small “Hosted Multiplayer Quick Deploy” section to README:
  - frontend host + backend host
  - set `VITE_MULTIPLAYER_API_URL`
  - verify `/api/multiplayer/health`
- Add a short “Player Onboarding” snippet:
  - open URL
  - host shares invite link
  - join and start.

## Suggested File Touch List

- `src/App.tsx`
- `src/ui/screens/MultiplayerScreen.tsx`
- `src/app/useMultiplayerRoom.ts`
- `src/network/multiplayerClient.ts` (only if link-join needs helper updates)
- `src/test/app.test.tsx`
- `README.md`
- `docs/FEATURE_RELEASE_NOTES.md`

## Test Requirements

Automated:

1. Joining via deep link path sets multiplayer screen + prefilled join code.
2. Invite link button appears for host after room creation.
3. Production copy does not include local-dev troubleshooting text.
4. Existing multiplayer smoke tests remain passing.

Verification commands:

1. `npm run test`
2. `npm run build`
3. `npm run lint` (allow existing known warning only)

## Manual Acceptance Script

1. Host opens app and taps `Play Multiplayer`.
2. Host taps `Host Multiplayer Game`.
3. Host taps `Copy Invite Link` and sends it.
4. Player 2 opens link on another laptop/phone.
5. App opens multiplayer screen with join code already filled.
6. Player 2 enters name and taps join.
7. Host starts match.

## Non-Goals (for this next session)

- Matchmaking/lobbies beyond private invites.
- Accounts/authentication.
- Dedicated relay/turn servers beyond current room API model.

## Definition of Done

- Invite-link flow implemented and tested.
- Docs updated for hosted-first usage.
- Production UX is non-technical by default.
- Local contributor workflow still works via `npm run dev:all`.
