# Turn-by-turn rooms, bot seats, spectators, unlockables, replay, series, timers and table reactions

**Status:** Accepted

## Problem
Online games need everyone present at once, one dropped player stalls a match, and nobody can watch. A finished game can't be rewatched, there's little to work toward, and turns have no sense of pace. Eric chose ideas C, D, E, J, L, O, P and R, with C only if it stays on his free accounts.

## Outcome
**C, turn-by-turn rooms.** A host can create a room that lasts for days. Players take turns whenever they like, and web players can get a notification when it's their turn. Rooms survive any server restart and cost nothing. iOS plays them too, but without notifications, which would need the paid Apple account.

**D, bots fill empty seats.** With the setting on (the default in new rooms), a dropped player's seat plays on as a bot instead of pausing the room. Returning takes the seat straight back.

**E, spectators.** Anyone with the code can watch a live room, with every hand hidden. They can't act or chat.

**J, unlockables.** New table styles and card backs are earned by wins and achievements, and the Settings picker shows what each needs. The existing three styles stay free.

**L, replay.** A finished game can be stepped through or played back on the table with its card animations and all hands visible, from the results screen or match history. The last 5 are kept.

**O, best of three.** Setup and rooms can choose a best-of-three series. Results show the score and offer the next game until someone wins two.

**P, speed and timers.** Every game shows a turn clock. Normal games count up with no penalty. Speed gives 45 seconds per turn, counting down and turning red in the last 10, and on expiry a bot makes the move. Turn-by-turn rooms show how long the current player has had.

**R, reactions.** Emoji fly from the sender's seat across the table, and Just Say No gets a full-screen stamp.

Web and iOS both get all of it. Cross-play keeps working, and an older client that ignores the new fields still plays.

## Constraints
- No paid plan. Turn-by-turn rooms use Vercel Functions and Vercel Blob on the Hobby plan. Confirmed by Eric as the condition for C. That the Hobby plan stops instead of billing at its limits is assumed.
- Rules, the engine and recorded games don't change, and `npm run replay:verify` and `npm run ios:verify` must pass without re-recording. Automation only plays legal actions.
- The protocol only gains fields and routes. Rooms behave as before unless the new options are set, so older clients and existing tests are unaffected.
- Nothing is pushed or deployed without Eric's say-so. Confirmed.
- The iOS simulator isn't booted without asking. Swift is verified with `swift test` and a device build.

## Non-goals
- iOS push notifications, which need the paid Apple account.
- Bots or speed timers in turn-by-turn rooms, because nothing runs between requests there.
- Spectator chat or reactions.

## Approach
Room rules stay in `gameService.ts` as pure functions over a room. The Render server drives bots and timers with its own timer per room. Turn-by-turn rooms load the same room from a private Blob, apply the same functions, and save with a compare-and-swap. Their six-letter codes tell clients where to connect, while live rooms keep five letters.

## Verification
- Service tests for each option: bot seats play and hand back, spectators see no hands and can't act, timers expire into a legal move, series score and finish, replay logs rebuild the final state.
- Tests for turn rooms against an in-memory store, including a conflicting save, a server restart and a stale move.
- Replaying recorded local and room games ends in the same state as the original.
- Real games through headless Chrome: every feature, including a two-browser turn-by-turn game. iOS: `swift test` and a device build.
- **Not covered until deployed:** the Vercel Function and Blob store themselves. Real notifications on a phone need Eric's device.

## Open questions
None
