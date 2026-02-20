# Game Loop Audit

## Primary turn flow

- Turn starts in `draw` phase.
- Active player draws (`draw_cards`), then phase becomes `action`.
- Player may play up to max plays per turn (default 3).
- Player passes turn; if hand > limit, forced discard flow is required before turn advances.
- Turn finalization checks winner and rotates current player.

Core functions:
- `createGame` (`src/engine/game.ts:428`)
- `getLegalActions` (`src/engine/game.ts:482`)
- `applyAction` (`src/engine/game.ts:512`)

## Pending interaction pipeline

Single pending interaction invariant:
- `state.pending` is exclusive and resolves through one of:
  - `counter`
  - `payment`
  - `rent`
  - `sly_deal`
  - `forced_deal`
  - `deal_breaker`

Pending legality and resolution lives in:
- `legalForPending` (`src/engine/game.ts:166`)
- `resolveEffect`/`maybeOpenCounter`/`continuePaymentChain` (`src/engine/game.ts:92`, `src/engine/game.ts:117`, `src/engine/game.ts:142`)

## Illegal move prevention

- Validation-first approach in `applyAction`.
- Invalid operations return stable `RuleError` codes.
- No rollback path is used because invalid mutations are blocked pre-commit or reverted inline.

## Winner detection

- Winner determined by complete set count threshold after action application.
- Functions: `checkWinner` and `isGameOver`.

## Risk hotspot

- `applyAction` handles many branches in one file and remains the highest regression-risk path.
