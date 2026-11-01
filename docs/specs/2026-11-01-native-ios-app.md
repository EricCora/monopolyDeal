# Native iOS app

**Status:** Accepted

## Problem
Monopoly Deal only runs in a browser. On iPhone that means a PWA, with web touch handling and no native sharing, haptics or app-style links. Eric wants a real iOS app with the features of the web version.

## Outcome
A SwiftUI app in `apps/ios/` that installs and runs on iPhone and iPad and offers:
- **Local play:** Classic and No Mercy, 2–5 players, pass-and-play with the reveal screen, Practice against easy and hard bots, custom Classic rules, undo, pause, coach hints.
- **Every rules flow on a touch UI:** payments with auto-select, Just Say No chains, Sly Deal, Forced Deal, Deal Breaker, Wild moves, buildings, debt chips and all No Mercy selections, with confirmation for risky plays.
- **Saved data:** autosave and resume, 5 save slots, match history, lifetime stats with filters, achievements, daily challenge, post-game recap, a shareable result image, the rules reference, table styles and reduced motion.
- **Online rooms against the existing server:** host, join by code or invite link, ready check, presets, variant choice, chat, reactions, activity feed, pause, undo, reset turn, checkpoints, rematch, automatic rejoin, Exit Match and Forget Room.
- **Native touches:** haptics, the share sheet, a `monopolydeal://join/<code>` link, an app icon and launch screen.
- **Graphics made for iOS:** vector cards that stay sharp at any size, native materials and Liquid Glass controls, animated card movement between hand and table, smooth 120 Hz motion on ProMotion screens, and a layout tuned for the iPhone 18 Pro Max that also works on iPad.

iOS and browser players can finish a match in the same room, and so can two iOS players.

## Constraints
- The server and its protocol don't change for this work. Web behavior is untouched. Confirmed (scope of the request).
- Work goes on a branch, each bug starts with a failing test, and nothing is pushed. Confirmed (global rules).
- The TypeScript engine stays the source of truth. The Swift engine must match its results, and any deliberate difference goes in `DECISIONS.md`. Assumed.
- No third-party Swift dependencies. HTTP and the server's existing SSE stream cover online play, so Socket.IO isn't needed. Assumed; the HTTP and SSE routes were read but not yet exercised from Swift.
- iOS 27 or later, with iPhone 18 Pro Max on iOS 27.2 as the main device. Confirmed.
- Personal use on simulator and Eric's own devices, keeping the current name and card style. Confirmed.

## Non-goals
- App Store submission, push notifications, Game Center, iCloud sync, Android.
- Importing saves from the browser, whose storage an app can't read.
- Universal links, which need an Apple Developer team and a file on the web host. Invites share the code plus both link forms.
- Porting developer-only tools: LAN dev mode, sample-data seeding and growth telemetry.

## Approach
A native rewrite, not a web wrapper. Rules, bots and stats live in a Swift package that `swift test` runs without a simulator, and the app target adds SwiftUI screens on top.

In a room, the server runs the rules and sends each client the state and its legal actions, so the Swift engine isn't involved and cross-play can't drift on rules. The Swift engine only runs offline games. A new or changed card still needs an app update to display, so the app shows an "update the app" message rather than failing on something it doesn't recognize.

Drift between the two engines is caught by test. The recorded games are committed, and `npm run quality` replays them against TypeScript, so a rule change there fails until they're re-recorded. `npm run ios:verify` then fails until Swift matches.

## Verification
- **Same results as the web engine:** a script plays seeded games in TypeScript and records every state and legal-action list. Swift replays them and must match exactly, excluding timestamps. At least 500 games per variant, including games with bots choosing the moves.
- **Fuzz:** the rules of `engine-fuzz.test.ts` are ported, and 2,000 random games per variant finish with no freeze, rejected legal move or lost card.
- **Saved games:** a version 1 state written by TypeScript decodes in Swift and continues correctly.
- **Online:** a Swift test client plays a full match on a locally run server against a TypeScript client, then against a second Swift client, including a dropped connection and rejoin.
- **Screens:** UI tests on the iPhone and iPad simulators play a Classic and a No Mercy game to a winner and create a room.
- A new `npm run ios:verify` runs these. `npm run quality` still passes.
- **Not covered automatically:** feel of animation and touch, and physical devices. A real device needs Eric's signing, so that check is his, with a short manual script provided.

## Open questions
None
