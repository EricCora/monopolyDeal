# Poker-style game table

**Status:** Accepted

## Problem
The table reads as a set of panels, not a game around a table. Opponents are rows of boxes at the top, so you can't see their sets being built the way you would at a real table. Their face-down hands take space without telling you anything. When a card is played on you, the table behind the prompt carries no sense of who is sitting where.

## Outcome
On iPhone portrait (iOS) and phone-width web, the game screen matches the mockup (artifact `7ZdsAVZc4QqPLhS8F4j5nw`, 9 screens):
- An oval wooden table with felt fills the space between the top bar and your hand. Draw and discard piles sit in the centre.
- Each opponent sits on the rail by a name pill showing name, cards in hand (a number, no card backs), sets completed, and a gold ring on the active player.
- Each player's property sets and bank are built on the felt in front of their seat as cascaded piles. Every card's colour band shows, with a progress tag ("2/3", "3/3 ✓"). Houses and hotels sit on their set.
- Every pile is turned to face its owner: across 180°, left 90°, right −90°, 5-player top seats about 166° and 194°. Yours face you.
- Seat layouts exist for 2, 3, 4 and 5 players. No pile overlaps a name pill, another seat's piles or the centre piles at those counts with a typical mid-game table (3 piles each).
- Opponents' cards drop to a smaller size at 5 players, or when a seat has more than 3 piles. The tag then carries current rent. Your piles stay full size.
- On other players' turns your hand folds into a "Your hand · N cards" bar that opens it. On your turn the hand fans out under the table.
- A card played on you comes up large over the dimmed table, as shipped in `c1a0674`, with the table still visible.
- Card flights (draw, play, pay, steal) still animate between hands, piles and the centre.

## Constraints
- iOS and web ship together and look the same; `apps/ios/App` stays the reference. Confirmed (CLAUDE.md).
- No rule, engine, server or save-format changes. Confirmed.
- Phones stay portrait-only. Confirmed (DECISIONS.md, 2026-11-01).
- Table text stops growing at `accessibility1`. Confirmed (DECISIONS.md).
- Existing UI tests keep passing. Any test that pins the old layout is raised with Eric before it changes, never edited quietly. Confirmed (CLAUDE.md).
- Your own piles stay tappable (moving wilds, picking cards to pay). Tapping an opponent's seat opens their board sheet, as now, because their turned cards are small. Assumed.
- The Mac has 8 GB of RAM: run one simulator job at a time, niced. Confirmed (memory).

## Non-goals
- A new landscape or wide layout for iPad and desktop web beyond scaling this one (see open questions).
- New animations beyond what card flights already do.
- Changes to the prompts other than "played on you", the rules, bots or online play.
- Collapsing very large piles into "×N" stacks. Kept for later if real games need it.

## Approach
Build a seat-layout function, shared in spirit between Swift and TypeScript, that maps player count and seat index to a rail position and rotation. Draw each player's piles from the existing board model. Port to iOS first, then match web. Replace the current opponent column and player board; keep the prompt panel, hand, top bar and card flights.

## Verification
- `npm run quality` and `npm run ios:verify` pass, including the existing UI tests.
- New tests for the seat layout: for 2–5 players, each seat's pile area stays inside the felt and doesn't intersect another seat, a name pill or the centre piles. Same cases on both platforms.
- Simulator screenshots (iPhone 18 Pro Max) and headless Chrome at 430×932 for 2, 3, 4 and 5 players, a late game and "played on you", compared side by side with the mockup.
- A full bot game played to the end on each platform, with no frozen or misplaced card.
- Not covered automatically: whether it feels right at the table. Eric plays a round on the phone after it's installed.

## Open questions
- Wide screens (iPad, desktop web): going with the default, the portrait oval scaled, with landscape as a follow-up. Eric can revisit.
- Opponent tags turned toward their owner, as in the mockup. Eric judges it on the phone.
