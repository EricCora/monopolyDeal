# Deep Research Branch Release Notes

Branch: `codex/deep-research-improvements`

## What Landed

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
- Uses `VITE_MULTIPLAYER_API_URL` (or current origin fallback) for one-click user flow.
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

## Manual Smoke Focus

1. Enable experimental flags and verify gated surfaces render only when expected.
2. Run a bot-enabled match and confirm bot turns execute automatically.
3. Complete a match and confirm post-game replay + achievement updates.
4. Use custom rules and validate prompts/limits match configured values.
5. Open Multiplayer screen and validate host/join/start/refresh/leave workflow without manual server URL entry.
6. Open Stats & History and verify new growth telemetry cards/chart update after gameplay actions.
