# Table Hold (god mode)

**Status:** Accepted

## Problem
Eric wants a hidden mode for his own games: whenever he has to draw, he sees the remaining deck and chooses the cards.

## Outcome
Holding the table still for 5 seconds (10 at first; shortened on 2026-11-18) turns the mode on; the same hold turns it off. Holding the hand never counts. While it's on, the turn draw (2, or 5 with an empty hand), Pass Go (2) and No Mercy's Pass Go Go Go (up to 7 in hand) first open a picker of the deck, grouped: actions (by type, rents in board-color order), then money (biggest first), then properties (by board color, plain cards before the wilds that share their color, any-color wilds last). The player chooses exactly as many cards as the draw takes (fewer if the deck is short), or cancels. Only the player who turned it on can tell: everyone else sees an ordinary draw in the log, the counts and the replay.

## Constraints
- Confirmed: web and iOS, in local games against bots, pass-and-play, online rooms (live and turn-by-turn) and nearby play.
- Confirmed: the setting lives only on the device (browser storage, `UserDefaults`). Nothing about it is sent anywhere; only the chosen draw is.
- Confirmed: the deck is shown only to the seat whose turn it is, and only when that seat asks.
- Confirmed: the mode belongs to the seat that held the table (the player whose turn it was, or the first human while a bot moved). At a pass-and-play table, nobody else's draws open the picker.
- Confirmed: replays log every draw with the cards it took, so a chosen draw is indistinguishable from any other.
- Assumed: the opening deal isn't a draw the player makes, so it stays random.
- Assumed: a short glint in the top corner and a haptic are enough to know the mode switched. There's no lasting badge.

## Non-goals
- Choosing the order of cards still in the deck, or seeing other hands.
- Hiding the glint and haptic at the moment of switching, which only the person holding the table sees.

## Approach
`draw_cards` and Pass Go's `play_action` take an optional `pick`, checked by the engine: each card must be in the pile once, and no more than the draw amount. Picked cards come out first, then the normal next cards. Rooms ignore `pick` when matching legal moves. The room `state` route takes `revealDeck=1`; nearby guests send `peekDeck`. The hold is pointer events on web and a window-level long-press recognizer on iOS, both cancelled by moving more than 14 points, and neither cancelling other gestures.

## Verification
- Engine tests in TypeScript and Swift: chosen draws, short picks, rejected picks, Pass Go, Pass Go Go Go, plays that draw nothing.
- Room tests: the pile shows only to the current seat; a picked draw is accepted, a bad one refused. Nearby loopback test for the same.
- Web: hold, picker and Draw tested in jsdom and in a real browser. iOS: `GodModeUITests` on iPhone and iPad.

## Open questions
None.
