# iOS app hardening

**Status:** Accepted

## Problem
The iOS app works on the simulator, but an audit found gaps. A dropped connection can leave an online player with no moves, room status messages are wrong or missing, hard bot speed on a phone is unmeasured, accessibility hasn't been reviewed, and some code has no tests.

## Outcome
- A seat the server marks disconnected recovers by itself and gets its legal actions back, with no player action.
- The app shows why a room is paused, how long a dropped player has to return, and when a room has ended.
- The room recovers after a server restart mid-match.
- A hard bot decision has a time limit, and long decisions show that the bot is thinking.
- Opponent plays, completed sets and the opening deal are animated, and the discard pile can be browsed. All respect Reduce Motion and Reduce Effects.
- Controls fit at the largest text sizes, and panels are solid under Reduce Transparency and Increase Contrast.
- The web bot's It's My Birthday score is fixed, and both engines' bot picks match at every recorded position.

## Constraints
- Work stays on `ios-app`, with nothing pushed or merged. Confirmed (global rules).
- A failing test comes first for each bug. Confirmed (global rules).
- The only web or server change is the bot fix. Confirmed (approved plan).
- No password, phone, Apple account, Vercel account or live server is available. Confirmed (Eric is away).

## Non-goals
- Engine rule changes, server changes or new online protocol.
- Running the UI tests, which need `sudo xcodebuild -runFirstLaunch`.
- Adding a web link to invites, because the site's address isn't known.
- Building TestFlight, push notifications, universal links, Game Center or iCloud sync. `docs/ios-next-steps.md` gives a recommendation for each.

## Approach
Work in priority order, with one commit per item, so stopping early still leaves finished work.

## Verification
- `npm run ios:verify -- --skip-ui` and `npm run quality` pass.
- Self-play covers 5 players, pass-and-play, every theme and Reduce Effects on iPhone and iPad, and an online match against the browser-style player, with no crashes and no memory growth between games.
- Every changed screen gets a screenshot review.
- **Not covered:** the UI tests, a real iPhone (feel and actual speed), the live server, and a full VoiceOver session.

## Open questions
None
