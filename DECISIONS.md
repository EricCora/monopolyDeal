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
