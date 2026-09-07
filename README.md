# Monopoly Deal (Local Web App)

A browser-based Monopoly Deal game built with React + TypeScript.

This project focuses on pass-and-play and private-room multiplayer gameplay with a rules engine, persistent saves, and match stats.

## Features

- 2 to 5 player local and private-room matches with custom player names
- Turn flow enforcement (draw, up to 3 plays, discard to 7, pass)
- Play handling for money, properties, wild cards, and action cards
- Counter flow with `Just Say No` chains
- Payment flow for card effects (including multi-opponent effects like `It's My Birthday`)
- Winner detection at 3 complete property sets
- Undo for reversible plays during the active turn
- Match history and lifetime win stats
- Dedicated Settings screen for display options and dev tooling
- Arcade-flagship visual direction with animated table ambiance, richer card surfaces, and stronger motion feedback
- In-match Pause/Resume control with persistent paused state
- Dev Mode tools to seed or reseed sample stats/history data
- Responsive hand layout (fan auto-scales and falls back to rail when space is tight)
- Property cards with rent ladder cells for faster set-to-rent readability
- Post-game brag image share (clipboard with download fallback)
- Home hero with animated card-back atmosphere and stronger CTA emphasis
- Home hero quick-facts strip and cleaner decorative card tableau so the landing page reads faster without overlapping scene labels
- Post-game celebration refresh with trophy treatment and richer confetti pulse
- Guided turn rail with draw/play/end-step progress and clearer required-action cues
- Prompt-reactive table focus strips and zone spotlights so draw/payment/selection/discard states reshape the active play surface instead of only changing copy
- New command-strip table header with active-player/step/pressure/pending status, plus one-tap timeline and insight toggles
- Priority turn banner and player-state chips that keep mandatory flows (payment/response/selection/discard) visible at a glance
- Pass-and-play reveal overlay now previews the next player, opening step, and turn number before the hand is revealed
- Discard pile now supports an in-panel browser (newest-to-oldest horizontal scroll) while keeping a compact top-stack preview
- Explicit pending-action messaging (rent, debt, counter chains, and steals) shown directly in the active UI, not just the event log
- Pending selection flows now highlight valid property targets directly on the table to reduce trial clicks
- Wild property repositioning now supports direct table interaction: tap a movable wild card, then tap a highlighted destination lane (`Move Here`)
- In-panel "money requested" banners so payment requests are obvious for the affected player
- Risky action confirmation dialog for high-impact targeted/rent plays
- Payment assistant auto-select for pending payment flows
- Payment validation hardening for manual debt selection (must satisfy amount when possible; shortfall only when total assets are insufficient)
- Zero-asset debt/payment requests can be confirmed as a valid $0 shortfall so turns never get stuck
- Official banking split enforced: Property cards (including Wilds) cannot be banked; money/action/building cards can be banked
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
- Lobby ready-check state, session presets (`Standard`, `Fast`, `Teaching`), and quick preset reactions
- Multiplayer activity feed (joins/reconnects/host changes/ready/reactions/checkpoints)
- Collapsible multiplayer activity panels, grouped room/host controls, and lobby snapshot cards with turn tagging for lower clutter on mobile layouts
- Multiplayer chat dock (bottom-left pill) with unread badge, typing indicators, mention highlighting (`@name`), and aria-log message semantics
- Chat auto-follows recent messages by default; when reviewing history it shows a `Jump to Recent` shortcut instead of forcing scroll snaps
- Multiplayer reconnect recovery UX that auto-clears stale sessions and avoids endless syncing states
- Multiplayer screen now surfaces a browser-local `Resume Your Room` card so refresh/reopen flows can recover the stored live room without re-entering the code
- UNO-style quick reactions via chat tray with transient per-player reaction bursts on lobby/table surfaces
- Flagship lobby presentation refresh with structured roster table, clearer status pills, and stronger action hierarchy
- Multiplayer in-match tables now carry a dedicated live-room pulse band with room/seat/rejoin/update context so online play reads differently from local hot-seat
- Hybrid live updates: Socket.IO transport (primary) with SSE/polling fallback
- Installable iPhone/Android PWA with Home Screen launch and offline app-shell fallback
- Multiplayer `Exit Match` (keeps reconnect session) and `Forget Room` (permanent disconnect) actions
- Multiplayer undo/reset-turn controls for the active player with server-authoritative snapshots
- In-match per-player connection pills and richer lobby disconnect timing labels
- Lobby leave behavior now frees seats immediately to prevent ghost rows and false `room_full` outcomes
- Copy actions now use consistent temporary feedback (`Room code copied.`, `Invite link copied.`) that auto-clears
- Pending deal interactions (`Sly Deal`, `Forced Deal`, `Deal Breaker`) support card-click selection flows
- Rent action cards now show compact rent summaries; compact rent ladders have improved readability
- Card type ribbons improve visual distinction between rent action cards and property cards
- Property steal outcomes are now surfaced with an in-table alert banner and temporary source/target/card highlights
- Draw actions now animate from deck to hand (respects reduced-motion/reduced-effects settings)
- Post-game recap now highlights winning move, momentum shift, and standout cards
- Experimental feature flags for AI opponents, AI coach hints, replay timeline, daily challenges, achievements, and custom rules
- Custom rule limits are reflected in table prompts, discard counts, action rails, and AI pass timing
- Auto-save + resume via `localStorage`

## Classic Rules

- Two-color Rent charges every opponent through separate counter/payment windows; any-color Rent charges one chosen opponent.
- A complete set needs at least one standard Property card. Excess properties belong to separate sets and are not protected by another complete set of the same color.
- An any-color Wild on its own earns no rent. Wilds can only occupy supported colors, including after a Forced Deal.
- Houses and Hotels attach to individual complete sets, excluding Railroads and Utilities. Each set allows one House and one Hotel; a Hotel requires a House.
- Custom Classic play, hand-limit, and victory presets remain available.

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

### Install on iPhone

The deployed HTTPS site can be installed without the App Store:

1. Open the site in Safari.
2. Tap the Share button.
3. Tap `Add to Home Screen`, then `Add`.

The installed app opens in its own full-screen window. Local saves and settings remain on that iPhone. The app shell can reopen without a connection after it has been loaded once, while live multiplayer still requires internet access.

## Scripts

- `npm run dev` - start local dev server
- `npm run dev:all` - start UI + multiplayer server for same-machine local development
- `npm run dev:lan` - start Vite on LAN (`0.0.0.0:5173`) for cross-device testing
- `npm run dev:lan:all` - start LAN UI + multiplayer server together, auto-clearing stale local dev listeners on ports `5173`/`8787`
- `npm run dev:lan:all:raw` - original concurrent LAN start without auto-cleanup
- `npm run lan` - alias for `npm run dev:lan:all`
- `npm run dev:multiplayer-server` - start the Node multiplayer API for local backend development
- `npm run build` - type-check and build production assets
- `npm run preview` - preview the production build locally
- `npm run lint` - run ESLint
- `npm run test` - run tests once
- `npm run test:watch` - run tests in watch mode
- `npm run quality` - run lint + tests + build as one baseline gate
- `npm run tree` - print a trimmed repo tree snapshot
- `npm run e2e:smoke` - run Playwright/Cypress if configured; otherwise run smoke UI tests
- `npm run replay:verify` - deterministic replay fingerprint verification (seed + command log)

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
  - Collapsed by default to reduce settings clutter
  - Includes multiplayer rollback toggles for live push updates and reactions
- Table style selector (`Premium Tabletop` / `Classic Felt` / `Neon Arcade`) persisted in local preferences

## Saved Games

- Home now surfaces primary modes for `New Game (Hot Seat)`, `Practice vs Bots`, and `Play Multiplayer (Live Online)`.
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
- `docs/BASELINE.md` - baseline commands, determinism path, and guardrail scripts
- `docs/IMPLEMENTATION_TRACKER.md` - staged full-audit modernization tracker

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
- `monopolyDeal.multiplayerRecovery.v1`

## Current Scope

- Local pass-and-play
- Private-room multiplayer (hosted API path)
- Private invite-link multiplayer (`/join/:roomCode`)
- Installable PWA for iPhone and other modern mobile browsers
- Legacy LAN scaffold is retained in the repo for development fallback but is not the primary user flow

### Multiplayer Match Controls

- Active multiplayer matches now open the full game table experience.
- Rules Reference drawer is available from active multiplayer matches.
- Host controls: `Pause/Resume`, `Save Checkpoint`, `Load Checkpoint`, `Delete Checkpoint`.
- Lobby host controls include `Start Match` and `Start From Checkpoint` (when checkpoint data exists).
- Start/rematch are ready-gated: the host can begin only when every connected room player has marked ready for the selected preset.
- Room presets are host-selectable in `lobby` and `finished`: `Standard` (default), `Fast` (2 complete sets to win), and `Teaching` (standard rules with clearer support copy).
- Finished multiplayer matches support same-room `Play Rematch` with the same roster, host, and selected preset.
- Lobby includes `Copy Room Code` and `Copy Invite Link` actions.
- `Copy Invite Link` resolves a LAN-shareable URL when hosting from `localhost`; if LAN origin discovery fails, room code is copied instead.
- Opening an explicit `/join/:roomCode` invite link now prefers join intent over silently auto-resuming an unrelated stored room session from the same browser profile.
- Multiplayer recovery is browser-local today: the screen shows one resumable live room from this browser profile, backed by a collection-ready recovery registry so recent/joined-room expansion can build on the same model later.
- Both copy actions show a short-lived in-UI notice and auto-dismiss after a moment.
- Lobby includes player-ready status, room chat, and chat-tray quick reactions.
- Player session controls: `Exit Match` (retain reconnect) and `Forget Room` (clear session).
- Active-turn controls: `Undo Last Play`, `Reset Turn Plays` (when snapshot history exists).
- Gameplay mutations reject stale game revisions; authenticated reconnects accept an older revision and return a fresh snapshot. Chat and presence use a separate event sequence so they do not invalidate moves. Exact action retries are scoped to the player and payload.
- Room snapshots expose only opaque deck placeholders (the remaining count), never the ordered draw-pile card identities.
- Multiplayer completions are written into Stats & History with session metadata (`mode`, `surface`, preset, room code) so live-online matches appear alongside local results.
- Multiplayer activity feed and host-change notices are surfaced in lobby/in-match UI.
- In local/dev contexts, multiplayer screens show a status chip that explicitly reports reconnect/version/pause policy activation, live-update transport state, and room runtime state.
- Dev status now includes explicit transport mode (`socket_primary` or `http_fallback`) so hidden rollout state is never ambiguous during local testing.
- Lobby disconnect policy: leaving in `lobby` removes your seat immediately; reconnect windows remain for `active`/`finished` matches only.
- Lobby stale-heartbeat policy: connected lobby seats are pruned after a 90s inactivity window to reduce false disconnects during tab/device switching in local beta testing.
- Active/finished stale-heartbeat policy: seats are marked disconnected after ~20s of missed heartbeat to keep in-match presence accurate when browser unload signals are dropped.
- Active matches pause during reconnect grace. When a seat expires, that competitor retires: their cards are discarded, affected interactions are resolved or canceled, and their turn is skipped. Matches continue with two or more remaining competitors; a sole remaining competitor wins. An expired host is replaced by a surviving competitor. Retirement clears undo/checkpoint history so the departed seat cannot be restored. Manual pause/resume cannot bypass a disconnect pause.

## Multiplayer Deployment Notes

HTTP JSON bodies are limited to 64 KiB (`MULTIPLAYER_MAX_JSON_BODY_BYTES`). Room creation is limited to 10 attempts per minute per socket address (`MULTIPLAYER_ROOM_CREATION_MAX_PER_WINDOW`, `MULTIPLAYER_ROOM_CREATION_WINDOW_MS`) with a 100-room process cap (`MULTIPLAYER_MAX_ACTIVE_ROOMS`). Behind a reverse proxy, clients sharing its socket address share that limit; forwarded headers are not trusted automatically.

Room persistence uses debounced atomic JSON snapshots in `apps/server/.multiplayer-room-snapshots.json`, with a flush on graceful shutdown. Persistence errors are logged; a corrupt/unreadable snapshot stops startup so it cannot silently be replaced with an empty store. Keep this path on a persistent disk. Abrupt process or machine failure can lose the most recent unflushed updates.

Set `VITE_MULTIPLAYER_API_URL` to your deployed multiplayer API origin.
See `.env.example` for the expected variable.
Production realtime requires a persistent Node multiplayer service (Socket.IO + HTTP API). Host the frontend separately (for example on Vercel) and point `VITE_MULTIPLAYER_API_URL` at that Node service.
For reconnect/resume implementation details and execution tracking, see `docs/multiplayer-reconnect-contract.md` and `docs/IMPLEMENTATION_TRACKER.md` (Epic C section).
Final closure artifact and acceptance mapping: `docs/PROGRAM_CLOSURE.md`.

Optional multiplayer behavior flags:

- `VITE_MULTIPLAYER_SOCKET_ENABLED` (`true` by default) to allow client Socket.IO realtime transport.
  - In local/LAN dev, Vite must proxy both `/api/multiplayer` and `/socket.io` to the multiplayer server (`:8787`) so socket commands do not stall before fallback.
  - Client transport now uses a short socket-failure cooldown (`12s`): after a socket failure it routes commands directly to HTTP fallback, then probes socket-primary again after cooldown.
- `VITE_MULTIPLAYER_PUSH_ENABLED` (`true` by default) to enable client push subscriptions.
  - Socket.IO is attempted first for room events.
  - SSE remains as fallback push transport, with an immediate bootstrap event and a 5s open-timeout guard.
  - If neither push transport establishes, UI falls back to polling automatically.
- `VITE_MULTIPLAYER_REACTIONS_ENABLED` (`true` by default) to enable quick reactions.
- Reconnect handshake, bounded reconnect retry/backoff, reconnect UI states, stale-action rejection, and disconnect pause/end policy are always active.
- `VITE_MP_RECONNECT_DEBUG` (`false` by default) to show reconnect diagnostics panel in multiplayer UI (dev-focused).
- `MULTIPLAYER_SOCKET_ENABLED` (`true` by default) emergency server-side kill switch for Socket.IO transport.
- `MULTIPLAYER_PUSH_ENABLED` (`true` by default) to enable server event stream endpoint.
- `MULTIPLAYER_REACTIONS_ENABLED` (`true` by default) to enable server reaction endpoint.
- `MP_RECONNECT_GRACE_MS` (`90000` default) to configure reconnect grace duration.

For local multiplayer development, the backend service is required.
Use the one-command startup:

1. Two-device LAN host flow: `npm run dev:lan:all`

## Deploying Online Multiplayer

Recommended production split:

1. Deploy the frontend to Vercel.
2. Deploy the multiplayer backend to Render using [`render.yaml`](./render.yaml).
3. In Vercel, set `VITE_MULTIPLAYER_API_URL` to your Render backend origin, for example `https://your-service.onrender.com`.
4. Redeploy the Vercel frontend after setting or changing that env var.

### Render backend

- The backend service is the persistent Socket.IO + HTTP server in [`apps/server/src/index.ts`](./apps/server/src/index.ts).
- Render can deploy it directly from this repo using the included Blueprint file [`render.yaml`](./render.yaml).
- Health check path: `/api/multiplayer/health`
- Start command: `npm run start:multiplayer-server`

Blueprint import link pattern:

```text
https://dashboard.render.com/blueprint/new?repo=https://github.com/EricCora/monopolyDeal
```

After the service is live, copy its public URL and use that as `VITE_MULTIPLAYER_API_URL` in Vercel.

### Vercel frontend

- Vercel builds the Vite app using [`vercel.json`](./vercel.json).
- Add this environment variable in the Vercel project settings:

```text
VITE_MULTIPLAYER_API_URL=https://your-render-service.onrender.com
```

- The frontend can then create rooms, join rooms, and reconnect over the internet using the hosted backend.

### How updates work after setup

For normal app changes, yes, you redeploy.

- Backend changes: push to GitHub and Render will redeploy the multiplayer server from the updated repo.
- Frontend changes: push to GitHub and Vercel will rebuild and redeploy the web app.
- If you only change frontend code, only the Vercel deploy needs to update for users to see the change.
- If you change server gameplay, room logic, reconnect rules, or networking behavior, Render needs a fresh deploy too.
- If you change `VITE_MULTIPLAYER_API_URL` or any other Vite env var, Vercel needs a redeploy because those values are baked into the frontend build.

If you want, I can handle those redeploys for you whenever you make changes, as long as the deployment access is available in this environment.
2. Share the Vite `Network` URL (example: `http://192.168.1.123:5173`) with Player 2.
3. Player 2 opens that URL, goes to `Multiplayer`, enters name + room code, and joins.

Notes:
- `dev:lan:all` now attempts to stop stale local Node/Vite/tsx listeners on `5173` and `8787` before boot.
- If either port is held by a non-dev process, startup aborts with a targeted message instead of silently failing.

For same-machine development, you can still run:

1. UI + multiplayer server together: `npm run dev:all`

If you prefer split terminals, you can still run:

1. App UI: `npm run dev`
2. Node multiplayer server: `npm run dev:multiplayer-server`

In production, users should only need to press `Play Multiplayer (Live Online)`.

## License

No license file is currently defined in this repository.
