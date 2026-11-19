# Delete saved games

**Status:** Accepted

## Problem
Saved Games can delete the five manual slots, but only behind "Are you sure?" dialogs (a browser `confirm()` on the web, an alert behind the "⋯" menu on iOS). The game in progress, the one Continue Playing offers, can't be deleted at all, so an unwanted game stays on Home until it's played out.

## Outcome
- On Saved Games, every row can be deleted, the game in progress included: a Delete button on the web, and on iOS a swipe left on the row (full swipe deletes) plus Delete in the row's menu.
- Deleting happens at once, with no dialog, and an Undo bar shows for 6 seconds. Undo puts back exactly what was removed: same slot id, name, dates and game, or the same game in progress.
- Deleting the game in progress removes the Continue Playing panel from Home.
- Same behavior on web and iOS.

## Constraints
- Confirmed: Apple's alert guidance says not to warn about intentional, undoable deletions; undo is the lighter, standard pattern.
- Confirmed: the iOS target is 27.0, so `swipeActionsContainer()` works on the existing `ScrollView` rows without availability checks.
- Confirmed: a game in progress's replay is matched by the game's `createdAt` on both platforms, so leaving it in storage after a delete is harmless and lets Undo restore it.
- Assumed: one Undo at a time is enough. A second delete replaces the first Undo (the first stays deleted).
- Undo of a slot is refused when all 5 slots have filled since (only possible during a game); the bar then says so.

## Non-goals
- No trash or recently-deleted list.
- No deleting from Home's Continue Playing panel or from inside a game.
- No multi-select.

## Approach
Storage gets a restore call for a slot and for the game in progress. The Saved Games screen keeps the last deletion in memory and shows the Undo bar. The iOS alert and the web `confirm()` for delete are removed.

## Verification
- Web unit tests (`src/test/saved-games-screen.test.tsx` and storage tests): Delete removes a slot and the game in progress with no dialog, Undo restores them unchanged, and the bar disappears after 6 seconds.
- iOS UI test: swiping a slot deletes it and Undo restores it; deleting the game in progress removes Continue Playing from Home.
- `npm run quality` and `npm run ios:verify`. Checked on real screens: headless Chrome and the simulator.

## Open questions
None.
