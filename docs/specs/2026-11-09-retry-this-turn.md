# Retry This Turn

**Status:** Accepted

## Problem
A replay shows how a decision played out, but the player has to start a new game to try a different decision.

## Outcome
Pause a finished local bot match replay on one of your turns and choose **Retry This Turn**. A separate practice table opens at that turn's draw step with the original hands, deck order, board and rules. Play through the rest of the game against the original bot seats and return to the same paused position in the replay from the table or results.

## Constraints
- Confirmed: Web and iOS ship together. The source replay, normal saves, match history, achievements and stats stay intact.
- Confirmed: Existing replay formats and multiplayer protocols remain compatible. The retry uses the normal rules engine and bot policies.
- Assumed: A retry is untimed, lasts while the practice table is open, and is available for completed local games with exactly one human seat. Older replays qualify when the match history identifies the game as local.

## Non-goals
- Retries from multiplayer or pass-and-play with multiple humans.
- Persisting or sharing a practice branch, or continuing an original best-of-three series.

## Approach
Select the recorded draw position for the current human turn and hand a copy to the local table. Keep the practice game separate from normal persistence and progression.

## Verification
- Check eligibility and replay reconstruction on both engines, including later turns and incomplete logs.
- Play a different move on web and iOS, return to the paused position, and verify that the original move still plays. Check that a finished retry leaves history and any saved game intact.
- Run the repository's web quality and iOS verification commands.

## Open questions
None.
