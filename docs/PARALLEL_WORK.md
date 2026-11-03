# Working in parallel

How several agents can work on this repo at once without getting in each other's way.

## Start of every task

Give each agent its own worktree and branch. Never share a checkout.

```bash
cd ~/Developer/monopolyDeal
git fetch origin
git worktree add ../monopolyDeal-<feature> -b feature/<feature> origin/master
cd ../monopolyDeal-<feature>
npm ci
```

Keep worktrees outside `~/Desktop` and `~/Documents`. iCloud offloads files there, which stalls every tool (`DECISIONS.md` has the history). Each worktree needs its own `npm ci`.

## What can't be shared

| Resource | Default | For a second agent |
| --- | --- | --- |
| Web dev server | 5173 | `npm run dev -- --port 5180 --strictPort` |
| Room server | 8787 | `PORT=8790 MONOPOLY_DEAL_SNAPSHOT_PATH=/tmp/rooms-8790.json npm run dev:multiplayer-server` |
| Web client's room server | localhost:8787 | `VITE_MULTIPLAYER_API_URL=http://localhost:8790 npm run dev -- --port 5180 --strictPort` |
| `npm run quality` and tests | Safe in parallel | Nothing needed |
| `npm run ios:verify --skip-ui` | Port and build folder are per checkout | `DEAL_VERIFY_PORT` overrides the port |
| iOS UI tests and simulators | **One agent at a time** | They use named simulators, and the Mac has 8 GB of memory |
| Installing on Eric's or Anna's iPhone | **One agent at a time** | Only from a commit that's on `master` |
| Live site, Blob store | Shared | Don't run `npm run verify:turn-live` repeatedly: see Limits |

Only run `npm run ios:verify` in full (with UI tests) if your agent is the only one using simulators.

## Who owns what

These change together, so check `git log origin/master -- <path>` before starting, and rebase often.

| Area | Files | Conflict risk |
| --- | --- | --- |
| Rules | `src/engine/`, `apps/ios/DealKit/Sources/DealEngine/` | High, and needs recorded traces. Only one rule change at a time |
| Local game flow | `src/App.tsx`, `apps/ios/App/Model/TableSession.swift` | High |
| Table screen | `src/ui/screens/GameTableScreen.tsx`, `apps/ios/App/Views/Table/TablePieces.swift`, `TableView.swift` | High |
| Rooms | `apps/server/src/gameService.ts`, `packages/shared/multiplayer.ts`, `src/app/useMultiplayerRoom.ts`, `apps/ios/DealKit/Sources/DealOnline/` | Medium |
| Nearby play (iOS only) | `apps/ios/DealKit/Sources/DealNearby/`, `apps/ios/App/Model/NearbyMatch.swift`, `apps/ios/App/Views/Nearby/` | Low |
| Stats and saves | `src/stats/`, `src/persistence/`, `apps/ios/DealKit/Sources/DealStats/` | Low |
| Styles | `src/ui/theme/` | Low: add new rules at the end of a file |

Prefer new files for new features, so high-risk files only gain a line or two of wiring.

## Generated files

Never merge these by hand. Take either side, then regenerate:

| File | Regenerate with | Needed after changing |
| --- | --- | --- |
| `api/turn-rooms.js` | `npm run build:turn-api` | Anything in `apps/server/src/`, `src/engine/`, `src/ai/` or `packages/shared/` |
| `apps/ios/DealKit/Tests/DealKitTests/Fixtures/engine-*.json` | `npm run traces:record` | Rules or the heuristic bot |

`npm run quality` fails if the bundle is out of date. `DECISIONS.md` and `docs/FEATURE_RELEASE_NOTES.md` merge by keeping both sides, so just add your entry.

## Every feature ships on both platforms

Web and iOS should match, and cross-play has to keep working.

- Rules go in TypeScript first, then `npm run traces:record`, then Swift until `npm run ios:verify` passes.
- Room protocol changes only add things. See `packages/shared/PROTOCOL_COMPATIBILITY.md`. A field in a request body named `seatId` or `resumeToken` is read as the caller's identity, so never use those names for anything else.
- UI matches `apps/ios/App`. Check real screens: headless Chrome for web, the simulator for iOS.

## Limits

Eric's priority is keeping free accounts free.

- Vercel Blob allows 2,000 writes and 10,000 uncached reads a month across every turn-by-turn room. Past that, those rooms stop for up to 30 days. `DECISIONS.md` explains how reads are kept low. Don't add polling or writes without working out the cost.
- Render's free server sleeps and forgets its disk, so nothing lasting can live there.

## Finishing a task

1. Run `npm run quality`, and `npm run replay:verify` if rules or bots changed. For iOS changes, `npm run ios:verify -- --skip-ui`, plus UI tests when you hold the simulator.
2. Add a `DECISIONS.md` entry for any rule or behavior choice, and update the docs your change makes untrue. `docs/README.md` lists which docs are current.
3. Rebase on `origin/master` and rerun the checks if anything came in.
4. Pushing, merging and deploying need Eric's go-ahead. A push to `master` deploys the web and room server straight away.
5. Remove the worktree: `git worktree remove ../monopolyDeal-<feature>`.
