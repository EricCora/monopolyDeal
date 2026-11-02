# Playtest round: set rules, tables, bots and the room between games

**Status:** Accepted

## Problem
Eric played a two-phone game and found two cases where a player held a winning table but couldn't win, plus rough edges around the log, banks, bots, timers and what happens after a match.

## Outcome
1. A two-color Wild plus an any-color Wild is a complete set, in Classic too. Two any-color Wilds still aren't.
2. Same-color piles rejoin by themselves. If two incomplete piles hold a set's worth of cards between them, they become a set and can win. Two Shacks on one complete set stay illegal.
3. The game log is redesigned on both platforms: grouped by turn, with who did what at a glance.
4. Tapping an opponent's bank fans out every card, on both platforms.
5. Your own bank scrolls when it holds more than fits.
6. A room's host can add bots alongside people and pick each bot's difficulty.
7. The host can choose the difficulty of a bot playing a dropped seat.
8. After a match, everyone stays in the room: results lead back to a lobby with chat, the roster and settings, and the next game starts from there.
9. The turn timer is a slider with stops at 30, 45 and 60 seconds, locally and in rooms.
10. Auto-Select and bots stop giving up properties and strong cards they don't need to.
11. A rent card lists its colors from most to least earned, with the amount.
12. A bot's win no longer counts as yours.
13. A match in the history opens to its log and a replay, and a replay can show any player's hand.

## Constraints
- Rules change in TypeScript first, then `npm run traces:record`, then Swift. Confirmed.
- Free accounts stay free. Turn-by-turn rooms have a hard monthly write budget. Confirmed.
- The protocol only gains fields and routes. Confirmed.
- Item 1 replaces Eric's earlier "two Wilds stay short" decision, at his request. Confirmed.

## Non-goals
Push notifications, which still need `vercel login`. iOS push.

## Verification
Failing tests first for items 1 and 2. Server tests for 6, 7, 8 and 9. `npm run quality`, `replay:verify`, `ios:verify`. Headless Chrome for web screens, and the simulator for iOS screens, both with screenshots read by me. A live check after deploy.

## Open questions
None.
