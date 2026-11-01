# Monopoly Deal

Web app with Classic and No Mercy variants: local pass-and-play, practice against bots and live online rooms.

**Verification command:** `npm run quality` (lint, tests, build). CI runs it on every pull request, along with `npm run replay:verify`.

## Layout
- `src/engine/`: pure, deterministic rules. Change rules here first, with a passing and a rejected case in the tests.
- `src/App.tsx`, `src/ui/`: local game orchestration and screens.
- `src/app/useMultiplayerRoom.ts`, `src/network/`: online client, reconnect and transport.
- `apps/server/src/`: authoritative room server.

## Working here
- `AGENTS.md` has the invariants and the fuller guide. `DECISIONS.md` has rule and behavior decisions with their reasons.
- `src/test/engine-fuzz.test.ts` plays random games and fails on a freeze, a rejected legal move or a lost card. Add any seed that exposes a new failure.
- `src/test/app.test.tsx` mocks `../engine` with an explicit list, so a new export from `src/engine/index.ts` used by `App.tsx` needs its own module or an updated mock.
