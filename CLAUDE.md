# Monopoly Deal

Web and iOS apps with Classic and No Mercy variants: local pass-and-play, practice against bots and live online rooms, with cross-play in rooms.

**Verification command:** `npm run quality` (lint, tests, build). CI runs it on every pull request, along with `npm run replay:verify`. After iOS changes, or any rule change, also run `npm run ios:verify`.

## Layout
- `src/engine/`: pure, deterministic rules. Change rules here first, with a passing and a rejected case in the tests.
- `src/App.tsx`, `src/ui/`: local game orchestration and screens. `src/ui/table/` holds table pieces. The look and feel follow `apps/ios/App`.
- `src/app/useMultiplayerRoom.ts`, `src/network/`: online client, reconnect and transport.
- `apps/server/src/`: authoritative room server. `gameService.ts` holds room rules, `index.ts` the live server on Render, `turnRooms.ts` the same rules for turn-by-turn rooms on Vercel.
- `api/`: the Vercel Function for those rooms. `turn-rooms.js` is generated: run `npm run build:turn-api`.
- `apps/ios/`: the SwiftUI app. `DealKit/` holds the Swift engine, bots, stats, room client and nearby play (`DealNearby`, iOS only); `App/` holds the screens.

## Working here
- **The repo lives at `~/Developer/monopolyDeal`.** Don't clone it onto the Desktop: iCloud offloads files there and stalls every tool.
- Several agents may be working at once. Use your own worktree and read `docs/PARALLEL_WORK.md` first. `docs/README.md` says which docs are current.
- Every feature ships on web and iOS, with the UI matching `apps/ios/App`. Check real screens: headless Chrome for web, the simulator for iOS.
- `AGENTS.md` has the invariants and the fuller guide. `DECISIONS.md` has rule and behavior decisions with their reasons.
- A rule change goes in TypeScript first. Run `npm run traces:record`, then port it to `apps/ios/DealKit/Sources/DealEngine` until `npm run ios:verify` passes.
- `src/test/engine-fuzz.test.ts` plays random games and fails on a freeze, a rejected legal move or a lost card. Add any seed that exposes a new failure.
- `src/test/app.test.tsx` mocks `../engine` with an explicit list, so a new export from `src/engine/index.ts` used by `App.tsx` needs its own module or an updated mock.
- After changing server, engine or bot code, run `npm run build:turn-api`, or `npm run quality` fails. The in-memory store in tests can't show how real storage behaves, so run `npm run verify:turn-live` after changing the store or deploying it.
- A push to `master` deploys to Vercel and Render. Vercel Blob's free limits are tight: `DECISIONS.md` has the numbers.
