# Nearby play

**Status:** Accepted

## Problem
Online rooms need the internet. Eric wants to play Anna on their two iPhones when they're together with no signal, such as on a plane or out in the country.

## Outcome
A **Nearby** mode in the iOS app:
- One phone hosts a table. Phones close by see it listed and join with a tap. No code, account, router or internet is needed.
- 2–5 seats: the host, up to four nearby phones, and bots the host adds. Classic or No Mercy.
- Each phone sees only its own hand. Undo and Reset Turn work for the player whose turn it is, as in a room.
- A phone that drops out, from a locked screen, the app going to the background or walking out of range, rejoins its seat by itself when it comes back. Play pauses meanwhile. The host can hand a dropped seat to a bot so the game goes on.
- If the host's app is closed, the game is saved. The host continues it from the Nearby screen, and the others rejoin their seats.
- Rematch with the same seats, stats and history on every phone, and the finished game's replay.

## Constraints
- iPhone only. Safari can't make peer-to-peer connections, so the web app can't join. This is an exception to "every feature ships on web and iOS", recorded in `DECISIONS.md`. Confirmed (Eric's request names the phones).
- No third-party dependencies, servers or accounts, so free accounts stay free. Confirmed.
- The rules aren't changed. The host runs the Swift engine, which `npm run ios:verify` already holds to the TypeScript one. Confirmed.
- Hidden information is masked the same way the room server masks it (`maskForViewer` in `apps/server/src/gameService.ts`). Confirmed by reading it.
- Both phones run iOS 27 and already have the app. Confirmed by Eric.

## Non-goals
- Chat, reactions, checkpoints, spectators, Speed and best-of-three at a nearby table. Players are in the same room.
- Moving the host role to another phone mid-game.
- Playing between a nearby table and an online room.

## Approach
**Transport:** Apple's Multipeer Connectivity, which finds nearby devices over Bluetooth and peer-to-peer Wi-Fi with no network and encrypts the link. The Network framework's peer-to-peer option doesn't use Bluetooth, and Wi-Fi Aware needs newer hardware than Anna's iPhone 17 is known to support (assumed, not checked).

**Authority:** the host's phone is the room server. A new `DealNearby` package target holds the table (seats, seat tokens, masking, legal actions, undo, pause, rematch) as plain Swift with no networking, so `swift test` covers it. It talks to the network only through a small transport protocol: Multipeer in the app, an in-memory pair in tests.

**Messages:** JSON. A guest sends join (name and seat token), moves, undo, reset turn and leave. The host replies with a seat, a refusal, or that guest's own view: the masked game, its legal actions and the seats. Every view carries a revision, and a move made against an old revision is refused rather than applied to a board the player didn't see.

**Screens:** the host and guest each implement `TableSession`, so the existing table, prompts and results screens run unchanged.

## Verification
- `swift test`: masking hides other hands, the draw pile and a third party's debt card. Moves from the wrong seat, stale revisions and unknown seat tokens are refused. A dropped guest pauses play and rejoins by token, and a seat can be handed to a bot. Undo is only for the turn's player. A host save restores the table. Full games run between a host and guests over the in-memory transport, through the same message code the app uses.
- `npm run ios:verify -- --skip-ui` and `npm run quality` pass.
- **On the two phones:** a Debug launch argument makes each phone host or join a table and play its seat by itself over Multipeer. A whole game finishes with both phones agreeing on the winner. Then the Release build is installed on both.
- **Not covered automatically:** how reconnecting feels after a locked screen, and range. Eric checks these with the device checklist in `apps/ios/README.md`.

## Open questions
None
