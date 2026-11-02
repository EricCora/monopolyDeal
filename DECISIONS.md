# Decisions

Decisions and their reasons. Superseded entries stay, marked as such.

## 2026-10-31: Deck exhaustion ends the game
With no cards in the deck, the discard pile or any hand, nobody can act again. The winner is decided by complete sets, then table value, then seat order. The printed rules don't cover this; seat order keeps the result deterministic.

## 2026-10-31: Debt left over when a player can't pay carries to their next turn
When plays or cards run out during the No Mercy debt phase, the turn moves on and the debt stays. The alternative, forfeiting the debt, would let players escape it by emptying their hand.

## 2026-10-31: A property that would complete a set with two Shacks starts a new set
Each loose property may carry a Shack, but a complete set may hold only one. Refusing the play could strand the card in hand, so it starts a new physical set.

## 2026-10-31: Cards in transit when the game is won go to the discard pile
The game is over, so nobody needs them, but every card stays accounted for.

## 2026-10-31: Deck-revealing plays can't be undone; the forced draw can
Undoing Pass Go gave a free look at the deck. The start-of-turn draw stays undoable because the same cards come back and no other choice is available before it.

## 2026-10-31: Clients can't set the match seed
Deck order is hidden information. `MULTIPLAYER_ALLOW_CLIENT_SEED=true` re-enables it for test servers only.

## 2026-10-31: Lobby seats survive a dropped connection for 30 seconds
**Superseded on 2026-11-01 (see below).**

Start is blocked while a seat is inside that window, so a refresh can't lose a place in the match. It's shorter than the 90-second match window because an empty seat holds up the host. A full room can still reclaim the seat for a new player.

## 2026-10-31: Automatic rejoin depends on how the page was opened
On `/`, the app returns to a live room unless the player chose Exit. On a `/join/` link it resumes only after a refresh of the same tab, tracked in sessionStorage, because a fresh link may be for another room. Existing tests require the manual Resume in that case.

## 2026-10-31: Forget Room retires the seat at once
Forgetting a room means the player won't return, so the others shouldn't wait out the grace period. Exit Match keeps the seat and the grace period.

## 2026-10-31: Duplicate names get a suffix
A second "Ann" joins as "Ann (2)" rather than being refused, so nobody is blocked from joining.

## 2026-11-01: The production backend URL is pinned in `vercel.json`
Vercel's dashboard held a `VITE_MULTIPLAYER_API_URL` for a suspended Render service, which broke multiplayer for every player. Setting it in the build command keeps the value in the repo and overrides the dashboard. The client connects to Render directly rather than through the rewrites, because Vercel rewrites may not carry WebSockets (assumed, not tested); the server already allows any origin.

## 2026-11-01: Lobby seats are held for 90 seconds, and Start waits only 30
Sharing an invite from a phone means leaving the browser, which drops the connection, so 30 seconds could cost the host their seat. The seat now gets the full reconnect window, while Start stops waiting after 30 seconds. An absent seat is removed when the match starts.

## 2026-11-01: The iOS app is a native Swift rewrite, kept honest by recorded games
SwiftUI with a Swift engine, rather than a web wrapper or the TypeScript engine running in JavaScriptCore. Offline games stay fast, including hard bots, because iOS apps can't use a JIT for JavaScript. The cost is two engines, so `npm run traces:record` records 1,000 games from TypeScript and Swift must reproduce every state, event, prompt and legal action. A rule change fails `npm run quality` until it's re-recorded, and then `npm run ios:verify` until Swift matches. In an online room the server runs the rules, so cross-play doesn't depend on this.

## 2026-11-01: The iOS bot scores It's My Birthday as intended; the web bot still has a bug
**Superseded** by "The web bot scores It's My Birthday too" below.

The web score table's key is `birthday` but the card's kind is `its_my_birthday`, so that card scores NaN in `src/ai/heuristic.ts`. Swift uses the intended 430. The recordings mark positions where the card is legal, and the bot comparison skips them. The hard bot can't be compared move for move, because NaN reaches its simulations, so it's tested by beating the easy bot. Fixing the web bug is a separate change, and it would let the comparison cover those positions.

## 2026-11-01: The iOS app talks to rooms over HTTP and SSE, not Socket.IO
The server already supports both, and this keeps the app free of third-party packages. An open event stream doesn't count as being seen, and the server marks a seat disconnected after 20 seconds, so the app also fetches the room every 15 seconds.

## 2026-11-01: Actions are sent to rooms as exact wire text
The server decides legality by comparing `JSON.stringify` of the action, so key order matters. `Action.wireJSON` writes keys in the TypeScript order, and the recorded games check that text.

## 2026-11-01: One tap plays money and properties; anything else asks first
On a phone a mis-tap is easy. Unlike the web app, an action card whose only option is the Bank, a discard or a debt repayment opens the chooser even with a single option.

## 2026-11-01: iPhone is portrait only
A hand, a board and opponents don't fit a phone's landscape height at a readable card size. iPad supports every orientation.

## 2026-11-01: iOS build output stays out of the repo
The project sits on a Desktop that syncs to iCloud, which uploads build folders and offloads files until they're read. `npm run ios:verify` builds in `~/Library/Caches/MonopolyDealBuild`.

## 2026-11-01: A hard bot on iOS can move Wilds at most twice per turn
Moving a Wild costs no play. The search sometimes keeps rating it highest, which freezes the game forever (seed 65, three-player No Mercy, turn 32). The web hard bot has the same bug and freezes at the same step; that fix hasn't been made.

## 2026-11-01: The hard bot's search stops after 2.5 seconds on iOS
A five-player Forced Deal can offer over 200 moves, which took up to 6.5 seconds on a Mac. Under the limit, moves are tried in heuristic order, so running out of time only drops the weakest. Games are no longer strictly repeatable move for move, which is acceptable because the hard bot isn't compared with the web bot.

## 2026-11-01: A disconnected seat reclaims itself
The server answers `invalid_session` both for a bad token and for a seat it marked disconnected, so the app tries to reconnect before treating the seat as lost.

## 2026-11-01: Two Wilds stay short of a complete Classic set (superseded)
Eric reviewed this while playing on iOS and kept the rule. The app now says why, instead of changing it. **Superseded 2026-11-02** by the decision below.

## 2026-11-02: Only a win by someone on this device counts as your win
Wins, quick wins, the unlocks built on them, and the daily challenge used to count any finished game, so a bot beating you earned "First Win". Records now carry `viewerWon`. Online that means this seat won. Locally, any person at the device counts, including in pass-and-play, and bots don't. Older records keep counting as before, and nothing already earned is taken away. Web online games now also count toward achievements, as iOS already did.

## 2026-11-02: The table wraps onto rows
The player's piles used to scroll sideways with empty table below them. They now wrap, and scroll down only if they outgrow the space.

## 2026-11-02: A two-color Wild and an any-color Wild make a complete set
Eric hit this in a playtest and said it's valid. Classic now matches No Mercy: only a set made entirely of any-color Wilds falls short.

## 2026-11-02: Auto-Select pays from the bank first, and bots hold strong cards
Auto-Select used to prefer an exact single card, so it could hand over a property while the bank could cover the debt. It now spends the bank first, plain money before banked action cards, then cards outside complete sets, then the cheapest complete set. A banked Deal Breaker is only $5, so paying with it beats giving up properties. It still gets used when it's the only bank card. The real fix is upstream: bots and timed-out turns no longer bank a Deal Breaker, Just Say No, Sly Deal, Forced Deal or Super Sly Deal unless the hand is over the limit.

## 2026-11-02: Rent choices run from most to least, and show the amount
Eric's message said a rent card "shouldn't" show this order. The chooser wasn't sorted at the time, so that was read as a typo for "should". **Assumption, not confirmed.** To undo it, remove `orderRentChoices` (web) and `orderingRent` (iOS).

## 2026-11-02: Bots are real seats in a room
A bot added by the host is a participant that's always connected and ready, with no client holding its token. Difficulty is stored per seat, and also applies to a bot covering a dropped player, with a room default until the host picks. Hard bots on the server have a 900 ms search limit, because the room server has one thread. In turn-by-turn rooms bots move inside the request that reached them, so a whole bot turn costs one Blob save.

## 2026-11-02: A finished room works as the lobby between matches
Nobody needs a new server state: a `finished` room accepts chat, ready, settings, bots and new players, and the host's Start is a rematch. Results stay up per client until that player taps Back to Lobby, so one player leaving doesn't interrupt another's results. Someone who dropped more than 30 seconds ago, or left for good, no longer blocks the next game; they lose their seat.

## 2026-11-02: Partial piles of one color rejoin by themselves
Paying with a card can leave 2/3 and 1/3 piles, and standard cards can't be moved by hand, so a player could hold a winning table and never win. When nothing is mid-resolution, the engine moves cards from later partial piles to the first, carrying Shacks along. It skips a move that would put two Shacks on a complete set.

## 2026-11-01: The iOS hand reacts to a hold after 60 ms
Spreading starts before a tap has ended, so a touch released within 250 ms without moving still counts as a tap. Slower thresholds felt laggy on a real phone.

## 2026-11-01: The iOS hand uses a UIKit touch recognizer instead of a SwiftUI gesture
Timing on an iPhone 18 Pro Max showed SwiftUI's `DragGesture(minimumDistance: 0)` delivering a resting finger about 700 ms late, and a tap only when the finger lifted. A `UIGestureRecognizer` on the same view got touches about 17 ms after they happened. The delay's source wasn't identified. A hold now responds as soon as the finger lands, at 60 ms.

## 2026-11-01: The web bot scores It's My Birthday too
The web score table now uses the card's real kind, so the card scores 430 on both platforms. The recordings no longer mark those positions, and the bot comparison covers every position in the 200 bot games. This changes how web bots play that card.

## 2026-11-01: Recorded games replay in parallel
The replay was most of `ios:verify`'s time. It now uses half the cores, so the Mac stays usable, and took 103 seconds here against about 12 minutes before. The checks are the same.

## 2026-11-01: The web hard bot gets the same Wild limit as iOS
A hard bot may move Wilds twice per turn on both platforms. Without the limit, a game could freeze with the bot moving a Wild back and forth, because a move costs no play. This changes only the top difficulty's choices.

## 2026-11-01: Accessibility rules for the iOS app
Reduce Transparency and Increase Contrast swap Liquid Glass for solid panels, and Increase Contrast also strengthens quiet text. Menus follow any text size. The table's text stops growing at `accessibility1`, because past that the board doesn't fit a phone.

Xcode's accessibility audit now runs with the UI tests, with these exceptions, each named in `AccessibilityAuditTests.swift`:
- Text on a card is artwork that scales with the card, and holding the hand or opening a card enlarges it.
- The table skips the Dynamic Type check, because of the limit above.
- The home title's gradient and the "Draw to start" status were flagged for contrast, but both read clearly in screenshots.
- iPad skips the contrast check, because there the audit fails white labels on dark glass that pass on iPhone and read clearly in screenshots.
- Assumption: the home screen's nameless "inaccessible text" issue is the decorative hero cards. The audit gives no element for it.

## 2026-11-01: The status line uses a dark panel with a colored border
A tinted glass panel washed out the white text on your turn. A dark panel with a border in the theme's color stands out as much and stays readable.

## 2026-11-01: Invite links use the web address from the GitHub repo's homepage
Invites now carry `https://monopoly-deal-smoky.vercel.app/join/CODE` as well as the app link. The page and its room server proxy were both confirmed to answer. The earlier `monopoly-deal.vercel.app` guess belongs to another site.

## 2026-11-01: The web app's presentation follows the iOS app
The web table, cards, menus and feedback were rebuilt to match `apps/ios/App`, down to card proportions and hand gesture timings (a 60 ms hold, a 250 ms tap window). The iOS screens are now the reference for how the game looks and feels; web-only features stay, in the Game Log sheet, Settings and the results screen. Rules, the server and saves didn't change.

## 2026-11-01: Cards are drawn in CSS and fly through one component
Each card is laid out in 100 units scaled by one variable, as in `CardView.swift`. `CardFlights` measures every marked card before and after a game update and flies a copy in a layer above the table, because scrolling boards would clip a real card. At most 28 fly at once, longest first, and the rest snap. The old ghost cards stay as a soft glow ahead of the card, since tests rely on them and it reads well.

## 2026-11-01: Ask-first applies to touch on the web, and a mouse stays one click
A mis-tap is a finger problem. A touch on an action card with one option, a discard or a debt repayment opens the chooser, as on iOS. A mouse or keyboard plays it directly, which is also what the existing tests require.

## 2026-11-01: Practice is a button plus a menu on the web
iOS's Practice opens four options. The web's button still starts a Classic game against an easy bot at once, because a test requires that, and a small chevron beside it opens the same four options.

## 2026-11-01: Bots, the daily challenge, achievements, sound and haptics are on by default on the web
They're always available on iOS. Browsers with saved preferences get these turned on once, tracked by `monopolyDeal.iosParityDefaults.v1`, and later changes in Settings stick. iPhones get sound but no vibration, because Safari has no vibration API.

## 2026-11-01: The rounded card font is bundled
SF Rounded only exists on Apple devices, so cards and titles fall back to Nunito, a 39 KB file bundled from `@fontsource-variable/nunito`. It's a build-time dependency with no request to a font service.

## 2026-11-01: Old table copy stays in the page for existing tests
Some tests pin copy from the old layout, such as "Monopoly Deal Local" and "Premium Tabletop Match Night". It's kept as screen-reader text or in the Game Log sheet, so no test was edited. Those tests no longer prove the text is visible.

## 2026-11-01: Turn-by-turn rooms run on Vercel, with private Blob storage
Render's free tier sleeps and forgets its memory and disk, so a room that lasts for days can't live there. Six-letter room codes route to a Vercel Function at `/api/turn`, which stores each room in a private Blob and uses compare-and-swap so two players' moves can't overwrite each other. Letting clients hold the snapshot was rejected, because an offline player's stale copy would lose moves. Web push uses VAPID keys set as Vercel environment variables. Eric chose this only if it stays on free accounts. **Checked 2026-11-01:** Vercel's Blob pricing page says Hobby users "will not pay for any additional usage". Instead, Blob stops for up to 30 days once a limit is passed.

## 2026-11-01: The function is bundled and the bundle is committed
Vercel can't run this repo's extensionless and `.ts` imports, so `api/turn-rooms.source.ts` is built by esbuild into `api/turn-rooms.js`. `npm run quality` fails if the two have drifted. Run `npm run build:turn-api` after changing server or engine code it includes.

## 2026-11-01: Turn rooms are built around Blob's free limits
Hobby allows 2,000 writes and 10,000 uncached reads a month. Every move is a write, so that's about a dozen full games a month, and this limit can't be engineered away while each move saves the room. Polls were using two reads each, which would have used up the month in about 17 hours of one open app. They now read through the CDN cache, which is free on a hit and can be up to a minute old, every 30 seconds. A client reads past the cache for 15 seconds after opening a room or changing it, so your own move always shows at once. Other players' moves can take up to about 90 seconds to appear.

## 2026-11-01: Room saves take their version from `head`
The ETag on `get` was refused by `ifMatch` after a blob's first overwrite, so only a room's first update saved. The in-memory test store couldn't show this, so `npm run verify:turn-live` plays a short game against real storage. Run it after changing the store or deploying the function.

## 2026-11-01: The server is now type checked
`apps/server/src/` wasn't in any TypeScript project. A refactor moved two helpers out of `index.ts` without importing them, and any rejected move then crashed the real server. Neither lint nor the tests noticed; a browser run did. `tsconfig.node.json` now includes the server, and `src/test/server-rejected-action.test.ts` drives the real process.

## 2026-11-01: Every mode shows a turn clock
Eric asked for this. It counts up normally. Speed counts down from 45 seconds and goes red under 10, and on expiry a heuristic bot moves, with later steps at 1.5 seconds. Bots aren't timed.

## 2026-11-01: New live rooms turn bots on from the client
The server's default stays off, so existing tests and older clients see no change. The web and iOS clients set it after creating a room. Bots and Speed aren't available in turn-by-turn rooms.

## 2026-11-01: iOS turn-by-turn rooms have no push
Push needs a paid Apple developer setup. iOS checks every 30 seconds while the app is open. Web push works where the browser supports it.

## 2026-11-01: The hand never scrolls sideways
Eric approved replacing two layout tests that required the old sidebar order and a sideways-scrolling tight hand. Scrolling and hold-and-slide want the same finger movement, so the hand always overlaps its cards to fit, as on iOS. The new tests check that the table stays on screen and that touches on the hand go to its gestures.

## 2026-11-02: The repo lives at ~/Developer/monopolyDeal
iCloud offloads files on the Desktop, including `.git` objects, which stalled every tool. Eric approved moving it. The Desktop copy went to the Trash, with its one unique item saved as the local branch `archive/no-mercy-wip`.
