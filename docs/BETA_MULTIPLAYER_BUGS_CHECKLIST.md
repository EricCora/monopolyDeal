# Multiplayer Beta Feedback — Agent Checklist

Use this doc as a **checklist backlog**. Each item is written so an LLM agent can:
- find the relevant code quickly
- understand likely root cause(s)
- implement a fix with clear acceptance criteria
- add/adjust tests where appropriate

## How to start a new agent chat

Paste something like:

> I found a lot of bugs documented in `docs/BETA_MULTIPLAYER_BUGS_CHECKLIST.md`. Please plan how to fix them and start with the highest priority items. Keep fixes small, add tests for logic changes, and verify multiplayer flows.

## System map (key files)

- **Multiplayer lobby UI**: `src/ui/screens/MultiplayerScreen.tsx`
- **Multiplayer client state (polling + localStorage session)**: `src/app/useMultiplayerRoom.ts`
- **Multiplayer HTTP client + error messages**: `src/network/multiplayerClient.ts`
- **Server room rules + host migration + legality validation**: `apps/server/src/gameService.ts`
- **In-game table UI (used for multiplayer once started)**: `src/ui/screens/GameTableScreen.tsx`
- **Action rail + “show all legal actions” debug list**: `src/ui/layout/ActionRail.tsx`
- **Rules drawer**: `src/ui/components/RulesDrawer.tsx`
- **Payment suggestion / payment option generation**:
  - `src/engine/game.ts` (`getSuggestedPaymentCards`)
  - `src/engine/core.ts` (`generatePaymentOptions`, `cardMoneyValue`)
- **Card visuals (rent ladder + compact rendering)**:
  - `src/ui/components/CardView.tsx`
  - `src/ui/cards.ts`

## Priority legend

- **P0**: blocks progress / major multiplayer break
- **P1**: significant UX/flow problem
- **P2**: nice-to-have / polish

---

## 1) Multiplayer gameplay UI + pending interactions

### [x] MP-GAME-01 (P0) Pending interaction “menu remains open” after cards like It’s My Birthday

- **Status (2026-02-16)**: Implemented in `codex/multiplayer-beta-hardening-p0p1`.

- **Report**: When playing *It’s My Birthday* (or similar cards that require opponent response/payment), the prior action UI/chooser remains open for the player who played it. They may not notice the opponent’s response unless they press Cancel.
- **Relevant code**
  - Chooser modal: `src/ui/screens/GameTableScreen.tsx` (renders `PlayChooser` from `chooser` state)
  - Multiplayer prompt derivation + click handlers: `src/App.tsx` (`handleMultiplayerCardClick`, `multiplayerPrompt`, `multiplayerIsMandatoryPrompt`)
  - Engine pending flow: `src/engine/game.ts` (`maybeOpenCounter`, `pending.kind === 'payment'|'counter'|...`)
- **Likely root cause**
  - UI state (`chooser`, `selectedCardId`) is not cleared when the multiplayer prompt changes away from the local player or when a pending interaction starts.
- **Fix plan**
  - Add a “multiplayer prompt changed” effect that clears:
    - `chooser`
    - `selectedCardId`
    - (optionally) `selectedPaymentCards` when you are no longer the payer
  - Gate `PlayChooser` rendering in multiplayer to only show when it’s your prompt / you can act.
  - Ensure the active-player inline panel reflects “waiting on opponent” cleanly.
- **Acceptance criteria**
  - After playing Birthday, the initiator’s chooser/actions close automatically.
  - The UI clearly indicates the game is waiting on the opponent’s payment/response.
  - No manual “Cancel” is required to see state updates.
- **Test notes**
  - Consider a UI test that simulates a prompt change and asserts chooser closes.

### [x] MP-GAME-02 (P0) Multiplayer win has no clear winner screen/overlay

- **Status (2026-02-16)**: Implemented in `codex/multiplayer-beta-hardening-p0p1`.

- **Report**: In multiplayer when someone wins it doesn’t show a screen/signifier. Request: confetti or equivalent.
- **Relevant code**
  - Local win flow uses `PostGameScreen`: `src/App.tsx` (`finalizeIfGameOver` → `screen='game_over'`)
  - Multiplayer never routes to `game_over`; it stays in `screen='multiplayer'` with `GameTableScreen`.
  - Multiplayer room view includes winner: `apps/server/src/gameService.ts` `roomView()` sets `winnerId`
- **Fix plan**
  - Add a multiplayer-friendly end-of-game overlay inside `GameTableScreen` when `isGameOver(game).done` is true.
  - Optionally reuse some celebration UI patterns (respect reduced motion/effects).
- **Acceptance criteria**
  - All clients see an obvious “Winner: <name>” overlay when game ends.
  - Multiplayer “Leave Room” remains accessible from that state.

### [x] MP-GAME-03 (P1) Per-player connection status should be clearer in active match

- **Status (2026-02-16)**: Implemented in `codex/multiplayer-beta-hardening-p0p1`.

- **Report**: Connection status of each player should be easier to see without clutter.
- **Relevant code**
  - Lobby displays per-player `connected` in a dense list: `src/ui/screens/MultiplayerScreen.tsx`
  - In-match displays only your connection label in top bar meta: `src/ui/screens/GameTableScreen.tsx`
  - Server tracks `lastSeenAt` but doesn’t expose it in view: `apps/server/src/gameService.ts`
- **Fix plan**
  - UI: show a compact per-player indicator (pill/dot) in match view.
  - Data (optional): expose “last seen” or “stale” status to distinguish transient disconnect vs gone.
- **Acceptance criteria**
  - In match view, users can quickly see which opponents are disconnected.

---

## 2) Rules reference + navigation in multiplayer

### [x] MP-UI-01 (P0) Rules Reference is inaccessible in multiplayer

- **Status (2026-02-16)**: Implemented in `codex/multiplayer-beta-hardening-p0p1`.

- **Report**: The rules reference seems inaccessible in multiplayer.
- **Confirmed root cause**
  - `RulesDrawer` is only mounted when `screen === 'game'` (local), not when `screen === 'multiplayer'`.
- **Relevant code**
  - Rules drawer component: `src/ui/components/RulesDrawer.tsx`
  - “Open rules” handler sets `showRulesDrawer = true`: `src/App.tsx` passed into multiplayer `GameTableScreen`
  - Mount site: `src/App.tsx` currently gates drawer on `screen === 'game'`
- **Fix plan**
  - Mount `RulesDrawer` whenever `showRulesDrawer` is true (or when `screen` is `game` OR `multiplayer`).
- **Acceptance criteria**
  - Clicking “Rules Reference” in multiplayer opens the drawer.
  - Escape closes it; focus restore works.

---

## 3) Payment bugs (LAN + hosted multiplayer)

### [x] MP-PAY-01 (P0) Manual payments sometimes rejected; “auto-select is the only valid payment”

- **Status (2026-02-16)**: Implemented in `codex/multiplayer-beta-hardening-p0p1`.

- **Report(s)**
  - “Pay feature for rent, etc, does not always work… had cards totaling the amount but it would not let me pay.” (LAN multiplayer)
  - “I think only the auto-select is going through as valid payment.”
- **Likely root cause (high confidence)**
  - Server validates actions by `JSON.stringify` exact-match against legal actions.
  - For `pay_request`, the `cards: string[]` ordering becomes significant.
  - Manual UI selection sends cards in click order; legal actions are generated from a sorted list → ordering differs → server throws `illegal_action`.
- **Relevant code**
  - Server legality check: `apps/server/src/gameService.ts` (`applyRoomAction`, compares `JSON.stringify(entry.action)` to `JSON.stringify(action)`)
  - Legal payment actions: `src/engine/game.ts` `legalForPending()` builds `pay_request` options from `generatePaymentOptions()`
  - Payment options ordering: `src/engine/core.ts` `generatePaymentOptions()` sorts cards ascending by value
  - Manual payment submission (multiplayer): `src/App.tsx` `submitMultiplayerSelectedPayment()` uses `selectedPaymentCards` as-is
- **Fix plan (recommended)**
  - **Server-side**: make legality comparison structural:
    - `pay_request.cards` treated as a multiset (order-insensitive)
    - (optionally) normalize before comparison
  - **Client-side backup**: sort `selectedPaymentCards` into canonical order before sending.
- **Acceptance criteria**
  - Paying succeeds when the selected cards are valid and total is sufficient (or shortfall allowed), regardless of click order.
  - Auto-select is not required.
- **Test notes**
  - Add a server test: same `pay_request` cards in different order should be accepted.

### [x] MP-PAY-02 (P1) Auto-select payment chooses weird combos (e.g., $3 requested selects 3 + 0)

- **Status (2026-02-16)**: Implemented in `codex/multiplayer-beta-hardening-p0p1`.

- **Report**: Auto selecting payment sometimes picks a 3 and a 0 card; user felt forced to select the 0.
- **Relevant code**
  - Suggestion scoring: `src/engine/game.ts` `getSuggestedPaymentCards()`
  - Option enumeration and truncation: `src/engine/core.ts` `generatePaymentOptions()` caps to 25 options
- **Likely root cause**
  - Option enumeration is truncated and can miss the simplest exact-match option depending on card distribution/order.
- **Fix plan**
  - Replace or improve `generatePaymentOptions` to reliably include:
    - any exact-match single-card option
    - low-card-count exact matches
  - Update suggestion scoring to strongly prefer exact matches and fewer cards.
- **Acceptance criteria**
  - If an exact single-card payment exists, auto-select always chooses it.
  - Zero-value selections only appear if they materially help meet constraints (ideally never).

---

## 4) Lobby/join/rejoin lifecycle issues

### [x] MP-ROOM-01 (P0) “After a user leaves a room, they can’t rejoin; sees room_started message”

- **Status (2026-02-16)**: Implemented in `codex/multiplayer-beta-hardening-p0p1`.

- **Report**: After a user has left a room, they seem unable to rejoin; they see “This match already started. Ask the host for a fresh room code.”
- **Relevant code**
  - Server blocks join once started: `apps/server/src/gameService.ts` `joinRoom()` throws `room_started` when `room.game` exists.
  - Client message: `src/network/multiplayerClient.ts` `multiplayerErrorMessage('room_started')`
  - Client “Leave Room” clears local stored session (so reconnect is impossible): `src/app/useMultiplayerRoom.ts` `leaveRoom()` → `clearSession()` removes `monopolyDeal.multiplayerSession.v1`
- **Design decision needed**
  - Is “Leave Room” intended to be a permanent leave (forget credentials), or just “exit UI”?
- **Fix plan (recommended UX)**
  - Split into two actions in started matches:
    - **Exit match (can rejoin)**: navigates away but keeps stored session
    - **Forget room**: clears stored session and disconnects permanently
  - Ensure reconnect flow is used for started matches (not join).
- **Acceptance criteria**
  - Exiting and returning within reconnect window re-enters the match.
  - Forgetting the room requires a fresh room or explicit reconnect credentials.

### [x] MP-ROOM-02 (P2) Prefer switching host back to original host on stable rejoin

- **Status (2026-02-16)**: Implemented in `codex/multiplayer-beta-hardening-p0p1`.

- **Report**: Host gets re-assigned properly, but should attempt to switch back to original host if they rejoin and are stable.
- **Relevant code**
  - Host migration today: `apps/server/src/gameService.ts` `migrateHost()` picks first connected participant.
- **Fix plan**
  - Track original host and re-prefer them after reconnect once stable.
- **Acceptance criteria**
  - Original host can regain host automatically on reconnect without disrupting play.

### [x] MP-ROOM-03 (P2) Offer resume-from-checkpoint at match start when same players

- **Status (2026-02-16)**: Implemented in `codex/multiplayer-beta-hardening-p0p1`.

- **Report**: Starting a multiplayer match should offer resuming from checkpoint if same players.
- **Relevant code**
  - Checkpoints exist server-side and UI host controls exist in match: `apps/server/src/gameService.ts`, `src/ui/screens/GameTableScreen.tsx`
- **Fix plan**
  - Add lobby UI to detect available checkpoints and allow host to load a checkpoint before continuing.
- **Acceptance criteria**
  - Host can resume from a saved checkpoint without starting a new room.

---

## 5) Visual clarity: rent on cards

### [x] MP-VIS-01 (P2) Rent is hard to see on cards in multiplayer

- **Status (2026-02-16)**: Implemented in `codex/multiplayer-beta-hardening-p0p1`.

- **Report**: In multiplayer, rent is sometimes hard to see on cards.
- **Relevant code**
  - Rent ladder rendering: `src/ui/components/CardView.tsx` renders compact rent ladder when `size === 'sm'`
  - Card visual model: `src/ui/cards.ts`
- **Fix plan**
  - Improve compact rent ladder readability (CSS sizing/contrast/spacing).
  - Consider on-hover/press “rent zoom” tooltip/popup for mobile.
- **Acceptance criteria**
  - Rent ladder is legible in typical multiplayer table density.

### [x] MP-VIS-02 (P2) Hard to see what rent *action* cards will charge

- **Status (2026-02-16)**: Implemented in `codex/multiplayer-beta-hardening-p0p1`.

- **Report**: It is hard to see what each card will charge for rent.
- **Relevant code**
  - Rent action cards currently show labels/badges but not rent matrix: `src/ui/cards.ts` / `CardView`
- **Fix plan**
  - Render a rent-matrix mini-table for rent action cards (from `card.rentMatrix`) or provide a quick detail popover.
- **Acceptance criteria**
  - Users can infer rent scaling from the rent card itself without opening Rules.

---

## 6) UX: legal action list and interaction style

### [x] UX-ACTIONS-01 (P1) “Exhaustive turn list of legal actions is convoluted and ugly”

- **Status (2026-02-16)**: Implemented in `codex/multiplayer-beta-hardening-p0p1`.

- **Report**: Testers dislike exhaustive legal-actions list. Request: “I just wanna click what cards I want, and where I want it to go.”
- **Relevant code**
  - Card-click play already exists: `src/App.tsx` (`handleCardClick`, `handleMultiplayerCardClick`)
  - ActionRail exposes “Show All Legal Actions” list: `src/ui/layout/ActionRail.tsx`
  - Lobby/LAN screens show raw action buttons: `src/ui/screens/MultiplayerScreen.tsx`, `src/ui/screens/LanPlayScreen.tsx`
- **Fix plan**
  - Make “Show All Legal Actions” clearly “Debug/Advanced” (and possibly dev-mode only).
  - Improve direct-manipulation affordances (click card → choose variant → place).
  - Keep Rules drawer accessible as reference.
- **Acceptance criteria**
  - Default gameplay does not present a wall of action buttons for common flows.

### [x] UX-DEALS-01 (P2) Click cards to select paid/requested cards during swaps/deals

- **Status (2026-02-16)**: Implemented in `codex/multiplayer-beta-hardening-p0p1`.

- **Report**: Selecting via text bubbles for swaps/deals is clunky; allow clicking cards.
- **Relevant code**
  - Pending interaction legal choices for `sly_deal`, `forced_deal`, `deal_breaker`: `src/engine/game.ts` `legalForPending()`
  - UI currently exposes them as action buttons in active player panel: `src/ui/screens/GameTableScreen.tsx`
- **Fix plan**
  - Implement a selection mode UI for those pending kinds:
    - click a target card
    - click destination lane (where needed)
  - Keep action-button fallback for accessibility.
- **Acceptance criteria**
  - User can complete those pending flows primarily by clicking cards/zones.

---

## 7) Stability / blank screen

### [x] STAB-01 (P0) Blank screen after toggling settings, exiting multiplayer, attempting to rejoin

- **Status (2026-02-16)**: Implemented in `codex/multiplayer-beta-hardening-p0p1`.

- **Report**: Toggling some settings then exiting multiplayer and trying to rejoin gave a blank screen.
- **Where to start**
  - `src/App.tsx` screen transitions (`openSettings`, `closeSettings`, `goHome`, multiplayer rendering gates)
  - `src/app/useMultiplayerRoom.ts` session load/reconnect behavior
  - Browser console errors during repro (likely a render-time exception)
- **Fix plan**
  - Add guardrails so null/partial multiplayer state cannot crash rendering.
  - Ensure errors surface as UI text (`error` state) instead of throwing.
- **Acceptance criteria**
  - No white/blank screen; failure modes show a recoverable error and allow refresh/leave.

---

## Appendix: Known behavior constraints (don’t “fix” by breaking rules)

- Multiplayer server currently treats rooms as:
  - joinable only in lobby
  - reconnect requires stored `playerId/sessionToken`
  - legality validation currently strict and revision-guarded
- Engine invariants to preserve (see `AGENTS.md`):
  - max 3 plays per turn
  - pending interactions are exclusive
  - discard-to-7 end turn rule
  - win at 3 complete sets
