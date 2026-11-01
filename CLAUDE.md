# Monopoly Deal

Web and iOS apps with Classic and No Mercy variants: local pass-and-play, practice against bots and live online rooms, with cross-play in rooms.

**Verification command:** `npm run quality` (lint, tests, build). CI runs it on every pull request, along with `npm run replay:verify`. After iOS changes, or any rule change, also run `npm run ios:verify`.

## Layout
- `src/engine/`: pure, deterministic rules. Change rules here first, with a passing and a rejected case in the tests.
- `src/App.tsx`, `src/ui/`: local game orchestration and screens.
- `src/app/useMultiplayerRoom.ts`, `src/network/`: online client, reconnect and transport.
- `apps/server/src/`: authoritative room server.
- `apps/ios/`: the SwiftUI app. `DealKit/` holds the Swift engine, bots, stats and room client; `App/` holds the screens.

## Working here
- `AGENTS.md` has the invariants and the fuller guide. `DECISIONS.md` has rule and behavior decisions with their reasons.
- A rule change goes in TypeScript first. Run `npm run traces:record`, then port it to `apps/ios/DealKit/Sources/DealEngine` until `npm run ios:verify` passes.
- `src/test/engine-fuzz.test.ts` plays random games and fails on a freeze, a rejected legal move or a lost card. Add any seed that exposes a new failure.
- `src/test/app.test.tsx` mocks `../engine` with an explicit list, so a new export from `src/engine/index.ts` used by `App.tsx` needs its own module or an updated mock.
