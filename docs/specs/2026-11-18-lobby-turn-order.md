# Host sets the turn order in the lobby

**Problem.** Seat order is turn order, and seats are filled in the order people arrive. A bot added before a friend joins always plays before them; a bot added after always plays after. Eric can't change it.

**Outcome.** Before a game, the host holds a player in the lobby and drags them to a new place. The top player goes first. Everyone in the room sees the new order, and the game is dealt in it.

**Where.** The lobby before the first deal: online rooms on web and iOS (live and turn-by-turn), and nearby tables on iOS. Pass-and-play setup is out of scope (not checked whether it already allows this).

**How.**
- Server: `setSeatOrder` in `apps/server/src/gameService.ts`, host only, any time the room isn't mid-match. The server also accepts it between matches, but neither app shows the control there yet. It goes through the existing `bots` route as `op: 'order'` with `seatOrder`, the list of every seat id. A list that misses, repeats or invents a seat is refused with `seat_order_mismatch`, so a seat that joins or leaves during the drag isn't lost. One request per drop, so a turn-by-turn room spends one Blob write.
- Nearby: `NearbyTable.reorder` before the deal. The table update the guests already get carries it.
- iOS: the host's Players list is reorderable with SwiftUI's `reorderable()` (hold and drag). Guests see a plain list.
- Web: a Turn Order card for the host. Hold a row (touch) or drag its grip (mouse), with up and down buttons for the keyboard.

**Kept the same.** New joiners and new bots still go to the end. Ready states and the host don't change. The host can move any seat, their own too.

**Non-goals.** A random-order button. Changing order mid-match.

**Verification.** `src/test/room-seat-order.test.ts` (including the reported case: bot added, friend joins, host moves the bot after them, the game follows), `src/test/turn-order-card.test.tsx`, nearby tests in `NearbyTests.swift`, the online integration test against a real server, then hands-on on both iPhones.
