# Table Hold (god mode)

**Status:** Accepted

## Problem
Eric wants a hidden mode for his own games: whenever he has to draw, he sees the remaining deck and chooses the cards.

## Outcome
Holding the table still for 10 seconds turns the mode on; the same hold turns it off. While it's on, the turn draw (2, or 5 with an empty hand), Pass Go (2) and No Mercy's Pass Go Go Go (up to 7 in hand) first open a picker of the deck, next card first. The player chooses exactly as many cards as the draw takes (fewer if the deck is short), or cancels. Everyone else sees an ordinary draw: the log, counts and timing are unchanged.

## Constraints
- Confirmed: web and iOS, in local games against bots, pass-and-play, online rooms (live and turn-by-turn) and nearby play.
- Confirmed: the setting lives only on the device (browser storage, `UserDefaults`). Nothing about it is sent anywhere; only the chosen draw is.
- Confirmed: the deck is shown only to the seat whose turn it is, and only when that seat asks.
- Assumed: the opening deal isn't a draw the player makes, so it stays random.
- Assumed: a short glint in the top corner and a haptic are enough to know the mode switched. There's no lasting badge.

## Non-goals
- Choosing the order of cards still in the deck, or seeing other hands.
- Hiding the pick from a finished room's replay log, which needs it to replay the game.

## Approach
`draw_cards` and Pass Go's `play_action` take an optional `pick`, checked by the engine: each card must be in the pile once, and no more than the draw amount. Picked cards come out first, then the normal next cards. Rooms ignore `pick` when matching legal moves. The room `state` route takes `revealDeck=1`; nearby guests send `peekDeck`. The hold is pointer events on web and a window-level long-press recognizer on iOS, both cancelled by moving more than 14 points, and neither cancelling other gestures.

## Verification
- Engine tests in TypeScript and Swift: chosen draws, short picks, rejected picks, Pass Go, Pass Go Go Go, plays that draw nothing.
- Room tests: the pile shows only to the current seat; a picked draw is accepted, a bad one refused. Nearby loopback test for the same.
- Web: hold, picker and Draw tested in jsdom and in a real browser. iOS: `GodModeUITests` on iPhone and iPad.

## Open questions
None.
