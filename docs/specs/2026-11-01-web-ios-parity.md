# Web parity with the iOS app

**Status:** Accepted

## Problem
The iOS app plays like a card game: a full-screen felt table, vector cards, a hand you can hold and slide along, and cards that fly to where they land. The web version still looks and behaves like a dashboard: stacked panels of status chips, CSS cards with small text, a hand with no gestures, and every player's zones in one long scrolling page. Eric wants the web version to match the app, especially in looks and in how nice the gameplay feels.

## Outcome
On a phone-sized and a desktop-sized browser, the web game matches the iOS app (`apps/ios/App`):
- **Cards:** the same vector faces, drawn at any size from one design: money, properties with rent ladders, two-color and any-color Wilds, action emblems and rent wheels, and the card back.
- **Table:** full-screen with no page scroll on the table, the three table styles as mesh gradients with felt speckle, and glass panels. It has the same top bar, status line, opponent summaries and mini boards, player board, action bar and hand. Wide screens get the same side column as iPad.
- **Hand:** an arc of cards where a tap plays, dragging up plays, and holding spreads the hand so you can slide along it with the card under your finger enlarged. New cards come in from the deck, and the opening hand is dealt card by card. A card that can't be played shakes and says why.
- **Motion:** cards fly between hand, board and discard, including bot and online moves. Another player's action card is spotlighted, completing a set gets a gold burst and banner, and winning gets canvas confetti. All of it respects Reduce Effects and `prefers-reduced-motion`.
- **Prompts:** the same floating panel for payment, Just Say No, rent targets, Sly Deal, Forced Deal, Deal Breaker and every No Mercy step, plus a bottom-sheet chooser with the card shown, risky-play confirmation, and sheets for an opponent's board, the discard pile, the log and an inspected card.
- **Menus:** home, setup, saved games, settings, stats, results, rules and online rooms use the same look, including Practice's four options.
- **Touch feedback:** sound on every platform and vibration where the browser allows it. `prefers-contrast` and `prefers-reduced-transparency` swap glass for solid panels, as the app does.

Nothing that works on the web today is lost, including features iOS doesn't have (room watch, replay timeline, stats tables, dev tools).

## Constraints
- Rules, engine, server, protocol, saves and recorded games don't change. Confirmed: this is presentation, so `npm run replay:verify` must stay green with no re-recording.
- Existing tests aren't edited, skipped or deleted. Confirmed (global rule). Where one pins old copy, it's kept reachable, and the final report names it so Eric can decide.
- No new runtime dependencies, and no images for cards. Assumed.
- Work stays on the branch `web-ios-parity`, and nothing is pushed or deployed. Confirmed (global rule).
- Safari is the main phone browser, and it has no `navigator.vibrate`, so iPhones get sound but no vibration. Confirmed by platform limits.

## Non-goals
- Changing the iOS app, or any rule.
- Liquid Glass's refraction, which browsers can't do. Blur, tint and a highlight edge stand in for it.
- Home-screen install changes beyond safe areas and viewport settings.

## Approach
Rewrite the presentation in `src/ui`, leaving `App.tsx`'s game logic in place and keeping `GameTableScreen`'s props. Card layout scales from a 100-unit design through one CSS variable, mirroring `CardView.swift`. Card flight uses one component that measures cards before and after each game update, so any move animates the same way, whoever made it.

## Verification
- `npm run quality` and `npm run replay:verify` pass, with no existing test edited.
- New tests cover the play-restriction messages (with an allowed and a refused case), hand gestures (tap, drag, hold, slide), and the ask-first rule.
- Real games in a browser: Classic and No Mercy against bots at iPhone (430×932) and desktop (1440×900) sizes, played to a winner with no console errors and no page scroll on the table.
- Screenshots compared with frames from the iOS UI test recordings.
- **Not covered:** feel on a physical phone, which needs Eric's hands. The iOS simulator isn't booted for this work, so the comparison uses the existing recordings.

## Open questions
None
