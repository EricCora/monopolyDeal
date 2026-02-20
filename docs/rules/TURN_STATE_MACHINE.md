# Turn State Machine

## States

- `TURN_START` (logical start of active player turn)
- `DRAWING` (`turn.phase = draw`)
- `ACTION_SELECTION` (`turn.phase = action`, no pending interaction)
- `CHOOSING_TARGET` (`pending.kind = rent`)
- `PAYMENT_SELECTION` (`pending.kind = payment`)
- `RESPONDING_COUNTER` (`pending.kind = counter`)
- `SELECTION_PENDING` (`pending.kind in {sly_deal, forced_deal, deal_breaker}`)
- `TURN_END_DISCARD` (`turn.endingTurn = true` and hand over limit)
- `GAME_OVER` (`winnerId` set or finish-state prompt)

## Transitions

- `DRAWING -> ACTION_SELECTION`
  - Trigger: `draw_cards`
  - Guard: active player and draw phase
- `ACTION_SELECTION -> CHOOSING_TARGET/PAYMENT_SELECTION/RESPONDING_COUNTER/SELECTION_PENDING`
  - Trigger: action cards that create pending interactions
- `CHOOSING_TARGET -> PAYMENT_SELECTION or RESPONDING_COUNTER`
  - Trigger: rent source chooses target
- `RESPONDING_COUNTER -> PAYMENT_SELECTION/SELECTION_PENDING/none`
  - Trigger: counter chain resolves/cancels
- `PAYMENT_SELECTION -> ACTION_SELECTION` or next target payment
  - Trigger: valid `pay_request`
- `ACTION_SELECTION -> TURN_END_DISCARD`
  - Trigger: `pass_turn` with over-limit hand
- `TURN_END_DISCARD -> DRAWING (next player)`
  - Trigger: discard count reaches hand limit
- `ANY -> GAME_OVER`
  - Trigger: winner condition satisfied

## Invariants

- At most one pending interaction at a time (`state.pending` tagged union).
- Non-pending actions are blocked while pending interaction exists.
- Plays used cannot exceed ruleset max.
- End-turn discard must complete before turn advances.

## File anchors

- State and pending model: `src/engine/types.ts`
- Transition logic: `src/engine/game.ts:512`
