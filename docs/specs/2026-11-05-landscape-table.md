# Landscape game table on iPhone

**Status:** Accepted (Eric picked the design, A5 + A3, and asked for it to be built, merged and installed)

## Problem
In portrait the hand's cards are small and crowded. Eric plays UNO in landscape and wants the same roomy cards here. On the current table, End turn sits in a full-width bar, and the oval's opponents take height that landscape doesn't have.

## Outcome
On iPhone, the game table runs in landscape and matches screens A3 and A5 on the design canvas (artifact `MQJy7KCnT8ezwpv94JTcnU`, page "Round 3"):
- **Top strip:** the menu button, then one compact seat per opponent (avatar, name, cards in hand, bank, set progress, gold ring on the active player), then a status cell ("Your turn" or whose turn, plays-left dots). Tap a seat to open their board sheet, as now.
- **Middle row:** draw and discard piles on the left, your Bank and sets in the centre (scrolling sideways if they don't fit), and Draw / End turn as a large button at the right edge, within thumb reach. Undo, Reset and Hint sit beside it as small buttons.
- **Bottom:** your hand at about 128 pt wide, fanned on an arc, running off the bottom edge. Hold-to-spread, tap and drag-to-play keep working.
- Menus, setup and other screens stay portrait. Entering a game turns the screen to landscape; leaving turns it back.
- A "Landscape table" setting (on by default) brings back the portrait poker table for anyone who prefers it.
- On the web, a short landscape viewport (height ≤ 500 px, wider than tall: a phone on its side) gets the same layout. Other sizes keep the poker table.

## Constraints
- No rule, engine, server or save-format changes. Confirmed. A new preference field decodes with its default, so old saves load. Confirmed (`Preferences` falls back per field).
- Supersedes the 2026-11-01 decision "iPhone is portrait only". Confirmed by Eric's request.
- Text stops growing at `accessibility1`; tap targets at least 44 pt. Confirmed (DECISIONS.md, Apple HIG).
- Layout clears the Dynamic Island and home indicator in both landscape directions. Confirmed (HIG).
- Existing UI tests keep passing. Tests that pin the portrait layout run with the setting off rather than being edited. Assumed.
- The Mac has 8 GB of RAM: one heavy job at a time, niced. Confirmed (memory).

## Non-goals
- A landscape layout for iPad or desktop web.
- Segmented set slots and the "1 set from winning" flag (A4).
- Changes to prompt panels beyond keeping them on screen in landscape.

## Approach
A new `LandscapeTable` view composed from existing pieces (`OpponentSummary`, `CentrePiles`, `BankStack`/`SetLane`, `HandFan`), chosen by `TableView` when the screen is wider than tall on a phone. Orientation lock through an app delegate mask that the table sets on appear. Web adds a matching layout under a media query in `GameTableScreen`.

## Verification
- `npm run quality` and `npm run ios:verify` pass.
- Simulator screenshots on iPhone 18 Pro Max in landscape with 2 and 5 players, a 10-card hand, and a payment prompt; headless Chrome at 932×430 for the same.
- A bot game played to the end in landscape with no stuck screen.
- Not covered automatically: how it feels in the hand. Eric and Anna play a round after install.

## Open questions
- Whether Anna wants the setting off. She decides on her phone.
