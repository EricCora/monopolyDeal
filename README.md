# Monopoly Deal (Local Web App)

A browser-based Monopoly Deal game built with React + TypeScript.

This project focuses on pass-and-play and private-room multiplayer gameplay with a rules engine, persistent saves, and match stats.

## Features

- 2 to 4 player local matches with custom player names
- Turn flow enforcement (draw, up to 3 plays, discard to 7, pass)
- Play handling for money, properties, wild cards, and action cards
- Counter flow with `Just Say No` chains
- Payment flow for card effects (including multi-opponent effects like `It's My Birthday`)
- Winner detection at 3 complete property sets
- Undo for reversible plays during the active turn
- Match history and lifetime win stats
- Dedicated Settings screen for display options and dev tooling
- In-match Pause/Resume control with persistent paused state
- Dev Mode tools to seed or reseed sample stats/history data
- Responsive hand layout (fan auto-scales and falls back to rail when space is tight)
- Property cards with rent ladder cells for faster set-to-rent readability
- Post-game brag image share (clipboard with download fallback)
- Guided turn rail with draw/play/end-step progress and clearer required-action cues
- Risky action confirmation dialog for high-impact targeted/rent plays
- Payment assistant auto-select for pending payment flows
- In-game rules reference drawer with property set/rent lookup and pending-flow help
- Stats filters (player/winner/date range) and settings data controls for clearing local stats/history
- Growth telemetry counters (starts/completions/rematches/share conversion/LAN activity/coach usage + multiplayer funnel/push health) surfaced in Stats & History
- Manual saved-game slots (up to 5) with load/save-over/rename/delete controls
- One-click multiplayer room flow (host/join/reconnect) with no manual server URL entry
- Invite-link multiplayer onboarding (`/join/:roomCode` deep links with auto-filled join code)
- Full multiplayer in-match table view (same board/event/action surfaces as local play)
- Multiplayer winner overlay with clear winner callout at match end
- Host-controlled multiplayer pause/resume and checkpoint save/load/delete controls
- Lobby host can start a match directly from an available checkpoint when lineup is compatible
- Lobby ready-check state and quick preset reactions
- Multiplayer activity feed (joins/reconnects/host changes/ready/reactions/checkpoints)
- Flagship lobby presentation refresh with structured roster table, clearer status pills, and stronger action hierarchy
- Hybrid live updates: server push notifications with polling fallback
- Multiplayer `Exit Match` (keeps reconnect session) and `Forget Room` (permanent disconnect) actions
- Multiplayer undo/reset-turn controls for the active player with server-authoritative snapshots
- In-match per-player connection pills and richer lobby disconnect timing labels
- Pending deal interactions (`Sly Deal`, `Forced Deal`, `Deal Breaker`) support card-click selection flows
- Rent action cards now show compact rent summaries; compact rent ladders have improved readability
- Experimental feature flags for AI opponents, AI coach hints, replay timeline, daily challenges, achievements, and custom rules
- Auto-save + resume via `localStorage`

## Tech Stack

- React 19
- TypeScript
- Vite
- Vitest + Testing Library
- ESLint

## Quick Start

### Prerequisites

- Node.js 20+ (Node.js 22 recommended)
- npm

### Install

```bash
npm install
```

### Run the app

```bash
npm run dev
```

Open the local URL shown by Vite (usually `http://localhost:5173`).

## Scripts

- `npm run dev` - start local dev server
- `npm run dev:all` - start UI + multiplayer server for same-machine local development
- `npm run dev:lan` - start Vite on LAN (`0.0.0.0:5173`) for cross-device testing
- `npm run dev:lan:all` - start LAN UI + multiplayer server together for two-device local play
- `npm run lan` - alias for `npm run dev:lan:all`
- `npm run dev:multiplayer-server` - start the Node multiplayer API for local backend development
- `npm run build` - type-check and build production assets
- `npm run preview` - preview the production build locally
- `npm run lint` - run ESLint
- `npm run test` - run tests once
- `npm run test:watch` - run tests in watch mode

## Settings

Use the `Settings` screen from Home (or the in-game top bar) to control:

- Reduced celebration effects
- Text scale (`normal` / `large`)
- Table density (`cozy` / `compact`)
- Risky action confirmations on/off
- Rules hint visibility on/off
- Dev Mode toggle and sample data reseed tools
- Local data controls (clear match history + lifetime stats + growth telemetry)
- Experimental features toggle section (AI/replay/challenges/achievements/custom rules)
  - Includes multiplayer rollback toggles for live push updates and reactions

## Saved Games

- `Resume Saved Game` on Home is a quick-resume shortcut for the active autosave.
- `Saved Games` opens manual slots (up to 5) with `Load`, `Save Here`, `Rename`, and `Delete`.
- In-game `Save Game` opens the same slot manager and can save the current match to a new or existing slot.

When a live match is open, the top bar includes `Pause` / `Resume`. Paused state is persisted, so reopening a saved match restores the paused overlay until resumed.

## Project Structure

```text
src/
  engine/        # Core game rules and action resolution
  cards/         # Card catalog and metadata
  ui/            # UI components, screen containers, and theme modules
    layout/      # Shared shell/top-bar/action-rail primitives
    screens/     # Home/setup/game/stats/post-game screen components
    theme/       # Tokenized CSS split by base/components/screens
  persistence/   # localStorage save/load helpers
  stats/         # Match records and lifetime stat aggregation
  test/          # Engine and UI tests
```

## Agent Documentation

For AI coding agents working on this repository:

- `AGENTS.md` - default operating instructions, invariants, and done criteria
- `docs/LLM_AGENT_GUIDE.md` - deeper architecture map, change playbooks, and test matrix
- `docs/REFRACTOR_SAFETY_PLAYBOOK.md` - refactor safety workflow, behavior-contract templates, and regression gates
- `docs/NEXT_CODEX_MULTIPLAYER.md` - next-session multiplayer simplification handoff instructions

## Engineering Quality Guardrails

To reduce regressions during refactors:

1. Define behavior contracts for impacted flows before code changes.
2. Add characterization tests when behavior is currently untested.
3. Keep refactor commits small and phase-based.
4. Run `npm run test`, `npm run build`, and `npm run lint` before handoff.
5. Update both user docs (`README.md`) and agent docs (`docs/LLM_AGENT_GUIDE.md`) for workflow or UX changes.

## Persistence

Game state and stats are stored in browser `localStorage` under versioned keys:

- `monopolyDeal.activeGame.v1`
- `monopolyDeal.savedGames.v1`
- `monopolyDeal.matchHistory.v1`
- `monopolyDeal.lifetimeStats.v1`
- `monopolyDeal.growthMetrics.v1`
- `monopolyDeal.uiPreferences.v1`

## Current Scope

- Local pass-and-play
- Private-room multiplayer (hosted API path)
- Private invite-link multiplayer (`/join/:roomCode`)
- Legacy LAN scaffold is retained in the repo for development fallback but is not the primary user flow

### Multiplayer Match Controls

- Active multiplayer matches now open the full game table experience.
- Rules Reference drawer is available from active multiplayer matches.
- Host controls: `Pause/Resume`, `Save Checkpoint`, `Load Checkpoint`, `Delete Checkpoint`.
- Lobby host controls include `Start Match` and `Start From Checkpoint` (when checkpoint data exists).
- Lobby includes `Copy Room Code` and `Copy Invite Link` actions.
- Lobby includes player-ready status and quick reaction controls.
- Player session controls: `Exit Match` (retain reconnect) and `Forget Room` (clear session).
- Active-turn controls: `Undo Last Play`, `Reset Turn Plays` (when snapshot history exists).
- Multiplayer state mutations are revision-guarded to prevent stale updates.
- Multiplayer activity feed and host-change notices are surfaced in lobby/in-match UI.

## Multiplayer Deployment Notes

Set `VITE_MULTIPLAYER_API_URL` to your deployed multiplayer API origin.
See `.env.example` for the expected variable.

Optional multiplayer behavior flags:

- `VITE_MULTIPLAYER_PUSH_ENABLED` (`true` by default) to enable client push subscriptions.
- `VITE_MULTIPLAYER_REACTIONS_ENABLED` (`true` by default) to enable quick reactions.
- `MULTIPLAYER_PUSH_ENABLED` (`true` by default) to enable server event stream endpoint.
- `MULTIPLAYER_REACTIONS_ENABLED` (`true` by default) to enable server reaction endpoint.

For local multiplayer development, the backend service is required.
Use the one-command startup:

1. Two-device LAN host flow: `npm run dev:lan:all`
2. Share the Vite `Network` URL (example: `http://192.168.1.123:5173`) with Player 2.
3. Player 2 opens that URL, goes to `Multiplayer`, enters name + room code, and joins.

For same-machine development, you can still run:

1. UI + multiplayer server together: `npm run dev:all`

If you prefer split terminals, you can still run:

1. App UI: `npm run dev`
2. Node multiplayer server: `npm run dev:multiplayer-server`

In production, users should only need to press `Play Multiplayer`.

## License

No license file is currently defined in this repository.
