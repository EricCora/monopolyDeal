# Effect Model

## Command model (current)

Current engine command surface already aligns to explicit intent commands:

- `draw_cards`
- `pass_turn`
- `play_to_bank`
- `play_property`
- `move_wild`
- `play_action`
- `discard_card`
- `counter_response`
- `pay_request`
- `sly_deal_pick`
- `forced_deal_pick`
- `deal_breaker_pick`

Source: `src/engine/types.ts`.

## Validation layer (current)

Validation is embedded in `applyAction` branch guards in `src/engine/game.ts`.

Near-term target (non-breaking):
- Keep command union unchanged.
- Extract reusable pure validators by branch without changing behavior.

## Reducer/state machine layer (current)

- `applyAction(state, command) -> { state, events, error? }`
- Pending-effect helpers:
  - `resolveEffect`
  - `maybeOpenCounter`
  - `continuePaymentChain`

## Event stream (current + target)

Current:
- `GameEvent[]` is appended to `state.history`.
- Events carry `type`, `message`, and optional structured `details`.

Target hardening:
- Preserve additive structured `details` usage.
- Avoid text-only parsing in UI where `details` is available.
- Keep event schema stable for replay and multiplayer UX surfaces.

## Recommended module decomposition path

- `rules/validators/*` for command guards
- `effects/resolvers/*` for pending/effect resolution units
- keep public engine API stable (`createGame`, `getLegalActions`, `applyAction`, `getNextPrompt`)
