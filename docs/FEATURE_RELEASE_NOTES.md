# Deep Research Branch Release Notes

Branch: `codex/deep-research-improvements`

## Update: Program Closure (Stages 4-6 Complete)

Branch: `codex/epic-c-20-21-reconnect-foundation`

Status: `complete`

- Finalized MD-C10 host disconnect runtime policy (always-on):
  - pause on disconnect in active/finished rooms,
  - host-specific pause semantics,
  - terminal `ended_timeout` on host timeout,
  - no host migration after match start.
- Finalized MD-C11 reconnect/resync coverage expansion across service/hook/screen/app tests, including prompt-flow reconnect scenarios and runtime-state transition smoke coverage.
- Finalized MD-C12 diagnostics guardrails:
  - reconnect diagnostics surfaced in dev UI via `VITE_MP_RECONNECT_DEBUG`,
  - structured server runtime/resume markers,
  - centralized token redaction helper (`apps/server/src/logging.ts`).
- Closed Stage 5 AI verification expansion:
  - extended `src/test/ai-contract.test.ts`,
  - added `src/test/ai-tier-matrix.test.ts`,
  - added `docs/ai/AI_DIFFICULTY_VERIFICATION_MATRIX.md`.
- Published final closure artifacts:
  - `docs/PROGRAM_CLOSURE.md`
  - updated `docs/ROADMAP.md`
  - updated `docs/IMPLEMENTATION_TRACKER.md`

### Verification run for this update

- `npm run test`
- `npm run build`
- `npm run lint`
- `npm run replay:verify`

## Update: Epic C Reconnect Foundation (Initial Slice)

Status: `complete` (superseded by Stage 4-6 closure entry above)

- Added reconnect contract artifact: `docs/multiplayer-reconnect-contract.md`.
- Added Epic C dependency tracker + decision log: `docs/IMPLEMENTATION_TRACKER.md`.
- Started non-breaking seat identity compatibility (`seatId`/`resumeToken` + legacy aliases).
- Added reconnect UI-state scaffolding and reconnect telemetry stubs for rollout debugging.

## Update: Gameplay Clarity + Chat + Recap Polish

Branch: `codex/gameplay-clarity-chat-polish`

## Update: Multiplayer Recovery + Reaction UX + Steal/Draw Feedback

Branch: `codex/gameplay-clarity-chat-polish`

### What landed

- Fixed stale-session resume dead-end:
  - Auto-clears stale multiplayer sessions when reconnect fails with `room_not_found` or `reconnect_expired`.
  - Preserves room code in the join field for fast rejoin.
  - Replaces infinite "Syncing Room..." with explicit recovery cards/notices.
- Upgraded reaction UX (UNO-style direction while keeping wire compatibility):
  - Removed tiny inline reaction rows from table/lobby.
  - Added quick emoji reaction tray inside chat dock, still mapped to `nice|wow|gg|oops`.
  - Added short-lived per-player reaction burst badges on lobby roster and in-match player panels.
  - Reaction entries remain in activity feed but are visually de-emphasized.
- Added structured gameplay event metadata:
  - `GameEvent.details` now supports draw and property-steal details.
  - Draw events include `playerId`, `count`, and `reason` (`turn_draw`, `pass_go`, `effect`).
  - Steal events include source/target ids, mode (`sly_deal`, `forced_deal`, `deal_breaker`), and affected `cardIds`.
- Steal clarity pass:
  - Added prominent in-table steal banner ("who stole what from whom").
  - Added temporary source/target player glows and stolen-card/lane highlights.
  - Added polite live-region status messaging for accessibility.
- Draw feedback pass:
  - Added visual deck representation on draw pile.
  - Added deck-to-hand ghost-card animation triggered by draw event metadata.
  - Animation is disabled when reduced motion/reduced effects is enabled.

### Verification run for this update

- `npm run test`
- `npm run build`
- `npm run lint` (passes; pre-existing React Compiler/TanStack warning remains in `StatsDashboard`)

### What landed

Gameplay clarity and correctness:
- Pending-action prompts now explicitly describe actor, target, card/effect, and expected response for rent, debt, counters, and steals.
- Event taxonomy normalized to `pay` for payment resolution telemetry/recap consistency (legacy `payment` remains tolerated in readers).
- `play_to_bank` now rejects regular property cards while allowing wild/action/money/building cards per official rules split.
- `pay_request` validation now enforces minimum payable amount when possible; shortfall is accepted only when payer total is insufficient.
- Multiplayer `pay_request` legality check is structural/order-insensitive so valid manual card picks are accepted.
- Removed double-confirm rent friction by skipping secondary confirmation on pending rent target resolution.
- Added prominent in-panel request banners (`Payment Requested`, `Respond to Counter`, `Select Property Target`) so players can see required actions without relying on logs.
- Rent and property visual distinction improved with explicit card role badges (for example `Rent Action` vs `Property`).

Multiplayer chat:
- Added room chat backend with bounded history, typing indicators (TTL), sanitization, max-length guard, and rate limiting.
- Added endpoints: `POST /api/multiplayer/rooms/:roomCode/chat` and `POST /api/multiplayer/rooms/:roomCode/typing`.
- Added chat/typing fields to shared room contracts and backward-compatible runtime normalization for legacy room snapshots.
- Added bottom-left multiplayer chat dock with collapsible chat pill, unread badge, composer, typing indicator, mention highlight for `@yourName`, and ARIA `log` semantics.

Postgame recap upgrade:
- `PostGameSummary` now includes deterministic `winningMove`, `momentumShift`, and `highlightCards`.
- Postgame screen now presents recap cards for winning move, momentum shift, and standout cards.
- Share image model now uses recap story fields (winning move + momentum shift + highlight cards).

### Verification run for this update

- `npm run test -- src/test/multiplayer-room-service.test.ts src/test/multiplayer-chat-dock.test.tsx src/test/card-ui.test.tsx src/test/app.test.tsx`
- `npm run test -- src/test/post-game.test.ts src/test/app.test.tsx`

### Manual smoke scripts added/recommended

1. Manual payment edge case (`Debt Collector`):
   - Set up a pending payment where payer can fully cover amount.
   - Confirm manual selection rejects underpayment and accepts valid full/over payment.
   - Set up a pending payment where payer cannot cover amount.
   - Confirm only “pay all available” selections are accepted.

2. Rent confirmation and request visibility:
   - Play a rent action requiring target selection.
   - Confirm only one confirmation layer appears.
   - Confirm affected player panel shows explicit payment request banner.

3. Multiplayer chat:
   - In lobby and in active match, send messages from two players.
   - Verify unread badge increments while collapsed and resets when opened.
   - Verify typing indicator appears/disappears.
   - Verify `@name` mention highlight appears for non-self messages.

4. Postgame recap:
   - Finish matches through rent closeout, deal-breaker closeout, and set-completion closeout patterns.
   - Verify `Winning Move`, `Momentum Shift`, and `Highlight Cards` populate deterministically.

## What Landed

- Flagship multiplayer follow-through:
- Invite-link onboarding with canonical deep-link route (`/join/:roomCode`) and lobby `Copy Invite Link`.
- Hybrid push transport: server event stream endpoint + client push subscription with polling fallback.
- Social lobby/game upgrades: per-player ready state, quick preset reactions, and bounded activity feed.
- Reliability UX upgrades: reconnect/disconnect in-match overlay and host-change visibility notices.
- Multiplayer presentation refresh:
- Rebuilt lobby into a structured roster table with clearer player status, hand/bank/set counts, and readiness tags.
- Added explicit self-identification in lobby roster (`You` tag + highlighted row).
- Upgraded multiplayer visual hierarchy (room hero, status pills, action grouping, activity timeline).
- Added dynamic polish (hero sheen, connection pulse, elevated hover states) to reduce static panel feel.
- Shifted the app palette away from blue-heavy gradients toward a flagship arcade direction.
- Arcade flagship UI overhaul:
- Added dual table style support (`classic_green`, `neon_arcade`) persisted in UI preferences.
- Rebuilt Settings IA into compact grouped cards with custom accessible switches and collapsed Experimental section.
- Upgraded card visuals with action SVG iconography, textured faces, richer card-back motif, and smoother interaction/selection animation.
- Added felt table surface treatment, pile summary cards, and deeper seat/panel styling for active table play.
- Upgraded Home and Post-game presentation with stronger CTA hierarchy, dynamic hero motion, and trophy-forward victory styling.
- Reversible release controls: client/server feature flags for push and reactions.
- Multiplayer funnel + push health telemetry counters added to growth metrics.
- Experimental feature flags for AI opponents, AI coach, replay timeline, daily challenges, achievements, custom rules, enhanced event log, and contextual previews.
- AI gameplay stack:
- Heuristic bot decisions
- Monte Carlo rollout decisions
- Explainable AI coach hints for human turns
- Replay timeline on post-game screen (flag-gated).
- Retention systems:
- Daily challenge seeding/progression
- Achievement progression/unlock surfacing
- Post-game unlock callouts
- Custom ruleset plumbing (win sets, hand limit, max plays per turn) across setup, engine enforcement, rematch, and prompts.
- One-click multiplayer experience:
- New `Play Multiplayer` home action (no user-facing server URL field)
- Hosted-API client flow for host/join/reconnect/start/action/leave
- Automatic reconnect attempts with persisted room session token
- Presence-aware room state and reconnect deadline messaging in UI
- Server-side host migration and disconnect grace window (5 minutes)
- Server health endpoint and inactivity cleanup to handle stale sessions/shutdowns
- Multiplayer lifecycle hardening:
- `/state` polling now refreshes room activity to prevent false inactivity cleanup
- Expired disconnected lobby participants are reclaimed before `room_full` checks
- `/state` now returns `reconnect_expired` when disconnected reconnect windows have elapsed
- Multiplayer parity expansion:
- Active multiplayer matches now render the full `GameTableScreen` experience (board, event log, inline actions, confirmations, previews, coach hints).
- Host-only room controls added: `pause`, `resume`, checkpoint `save/load/delete`.
- Active prompt player can now run server-authoritative `undo` and `reset-turn` actions.
- Room state now includes `paused`, `pausedByPlayerId`, `revision`, `turnSnapshotCount`, and checkpoint summaries.
- Mutating multiplayer operations now accept optional `expectedRevision` and return `revision_conflict` on stale writes.
- Accessibility/game-feel improvements:
- High contrast mode, keyboard shortcuts, live-region updates
- Sound and haptics toggles
- Richer event log grouping and contextual action metadata
- Engine safety-net expansion:
- Added pending-flow invalid-path tests
- Added custom-rules prompt/limit tests
- App/engine maintainability refactors:
- Extracted engine shared helpers into `src/engine/core.ts`
- Extracted App orchestration hooks into `src/app/useFeedback.ts` and `src/app/useMultiplayerRoom.ts`
- Added shared multiplayer protocol contract and modernized local server endpoints under `/api/multiplayer/...`
- Analytics expansion:
- Extended growth telemetry counters (starts, completions, rematches, LAN host/join, coach hint views, share conversion)
- Stats dashboard now shows telemetry KPIs and growth-event chart
- Multiplayer beta hardening:
- Pending-action chooser now closes when multiplayer prompt ownership changes, avoiding stale local action UI.
- Multiplayer winner overlay now appears in-table when the match ends.
- Rules drawer now opens during multiplayer matches (same escape/focus behavior as local).
- `pay_request` legality now compares structurally with order-insensitive card sets; manual payment order no longer causes false `illegal_action`.
- Auto-payment selection now consistently prefers exact single-card matches when available.
- Active match controls split into `Exit Match` (keep reconnect session) and `Forget Room` (clear session).
- In-match player cards now show compact connection status pills.
- Multiplayer fallback guard now refreshes incomplete room payloads instead of risking blank-screen render paths.
- Original host is re-preferred automatically after successful reconnect.
- Hosts can start a lobby match from an available checkpoint when player lineup matches checkpoint participants.
- Pending deal selections now support property-card click flows for `sly_deal`, `forced_deal`, and `deal_breaker` (with chooser fallback for multi-destination variants).
- Compact rent ladders increased legibility; rent action cards now include inline rent summary lines for faster at-a-glance charge estimation.

## Interface And Data Updates

- `src/stats/types.ts`:
- `GrowthMetricEvent` expanded with:
- `game_started`
- `game_completed`
- `rematch_started`
- `lan_room_hosted`
- `lan_room_joined`
- `coach_hint_viewed`
- `GrowthMetricsV1.events` expanded with matching additive counters.
- `src/persistence/storage.ts`:
- Growth metric loader now backfills new counters safely for existing v1 payloads.
- Added `clearGrowthMetrics()` helper.
- `src/network/multiplayerClient.ts`:
- Added hosted multiplayer client with endpoint helpers and friendly error mapping.
- Uses `VITE_MULTIPLAYER_API_URL` with localhost-aware fallback (`http://localhost:8787` in local dev, same-origin fallback otherwise).
- Multiplayer unreachable messaging now includes actionable local guidance for starting the backend service.
- Added pause/resume/undo/reset-turn/checkpoint endpoint helpers and revision-aware mutation payloads.
- Added `/ready` and `/reaction` endpoint helpers plus `subscribeMultiplayerRoomEvents` for push updates.
- Added runtime feature-flag resolver (`VITE_MULTIPLAYER_PUSH_ENABLED`, `VITE_MULTIPLAYER_REACTIONS_ENABLED`).
- `packages/shared/multiplayer.ts` + `src/network/multiplayerTypes.ts`:
- `MultiplayerPlayerSummary` now includes `ready`.
- `MultiplayerRoomView` now includes `activityFeed` and `lastEventId`.
- Added reaction and push envelope shared types.
- `apps/server/src/index.ts`:
- Added event stream endpoint `GET /api/multiplayer/rooms/:roomCode/events`.
- Added ready endpoint `POST /api/multiplayer/rooms/:roomCode/ready`.
- Added reaction endpoint `POST /api/multiplayer/rooms/:roomCode/reaction`.
- Added server flags: `MULTIPLAYER_PUSH_ENABLED`, `MULTIPLAYER_REACTIONS_ENABLED`.
- `apps/server/src/gameService.ts`:
- Room participants now track `ready` and reaction cooldown timestamps.
- Room state now stores bounded activity feed entries for lobby/match status context.
- `src/stats/dashboard.ts`:
- `buildStatsDashboardModel` now accepts optional growth metrics input and returns `growthKpis` plus `growthEvents` series.

## Compatibility

- Storage remains `version: 1`.
- All new persistence fields are additive and default-backed.
- Legacy `growthMetrics` and `uiPreferences` payloads remain readable.

## Verification

- Required verification executed on branch:
- `npm run test`
- `npm run build`
- `npm run lint` (passes with pre-existing TanStack table warning)
- Additional targeted hardening run:
- `npm run test -- src/test/multiplayer-room-service.test.ts src/test/multiplayer-client.test.ts src/test/engine.test.ts src/test/app.test.tsx`

## Manual Smoke Focus

1. Enable experimental flags and verify gated surfaces render only when expected.
2. Run a bot-enabled match and confirm bot turns execute automatically.
3. Complete a match and confirm post-game replay + achievement updates.
4. Use custom rules and validate prompts/limits match configured values.
5. Open Multiplayer screen and validate host/join/start/refresh/leave workflow without manual server URL entry.
6. Open Stats & History and verify new growth telemetry cards/chart update after gameplay actions.
7. Host a room and verify `Copy Invite Link` shares `/join/<ROOM_CODE>` URL that pre-fills join form on open.
8. Confirm lobby ready toggles and quick reactions appear in room activity feed for all connected players.
9. Simulate push disconnect (or unsupported browser) and verify polling fallback keeps room state usable.
