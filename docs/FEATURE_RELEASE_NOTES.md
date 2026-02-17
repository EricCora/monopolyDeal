# Deep Research Branch Release Notes

Branch: `codex/deep-research-improvements`

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
- Shifted the app palette away from blue-heavy gradients toward a board-inspired green/gold/red direction.
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
