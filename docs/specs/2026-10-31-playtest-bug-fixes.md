# Fix the bugs found in the playtest

**Status:** Accepted

## Problem
A playtest of the working tree found bugs that crash No Mercy for every client, hang Practice vs Bots by default, lose a player's seat on refresh, soft-lock No Mercy games, and leak hidden information or weaken room security.

## Outcome
- A No Mercy action response renders instead of crashing, and a render error shows a recovery screen rather than a blank page.
- Practice vs Bots plays through with default settings.
- A refresh in the lobby or mid-match returns the player to their seat without a manual step.
- 2,000 fuzzed games finish with no soft-lock and no legal action rejected.
- Undo cannot reveal cards drawn by Pass Go, clients cannot choose the match seed, and session tokens come from a CSPRNG.
- Undo snapshots are bounded. The medium and low items in the report are fixed, except those under Non-goals.

## Constraints
- Failing test committed before each fix, without editing it afterwards. Confirmed (global rules).
- Engine stays pure and deterministic; existing replays still verify. Confirmed (AGENTS.md).
- Nothing is pushed and `master` is not touched. Confirmed (global rules).
- Existing rooms persisted on the server keep loading. Assumed.

## Non-goals
- A full table redesign. Only scroll and reach problems are fixed.
- CI, repo restructuring, and moving the repo out of iCloud.
- Card-by-card rules audit.

## Approach
One commit pair per bug on `fix/playtest-bugs`, based on a snapshot of the uncommitted No Mercy work.

## Verification
`npm run quality`, the fuzz harness, and a multi-seat browser rerun of Classic, No Mercy, Practice and the refresh paths. Not covered: production on Render/Vercel, Safari/iOS.

## Open questions
None blocking. Rule interpretations are recorded in `DECISIONS.md`.
