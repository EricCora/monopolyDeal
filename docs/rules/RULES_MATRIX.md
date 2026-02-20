# Rules Matrix (Current Implementation)

This matrix documents implemented card/effect behavior in `src/engine/game.ts` and `src/cards/catalog.ts`.

## Core turn rules

- Draw phase must resolve before action phase (`draw_cards` only legal in draw phase).
- Action phase allows up to `maxPlaysPerTurn` (default 3).
- End turn requires discard to `maxHandAtEndTurn` (default 7).
- Win at `winCompleteSets` complete sets (default 3).

## Action/effect matrix

| Card / Effect | Prerequisites | Targets | Resolution | Counter / cancel behavior |
|---|---|---|---|---|
| `pass_go` | Active player, action phase, play budget available | Self | Draw 2 cards; consume 1 play | Can be countered if target has `just_say_no` path opened |
| `rent` / `rent_wild` | Active player, action phase, valid owned rent color | Select target after rent card play | Opens `pending.rent`, then selected target enters payment flow | May be countered before payment effect resolves |
| `double_rent` | Active player, action phase, playable rent follow-up exists | Self | Multiplies rent amount for next rent | Must be legal before play; otherwise rejected |
| `debt_collector` | Active player, action phase | One opponent | Opens payment request for `$5` | Counter chain via `just_say_no` before payment |
| `its_my_birthday` | Active player, action phase | All opponents (sequence) | Payment chain `$2` per opponent | Counter can cancel one target request; chain continues to remaining |
| `sly_deal` | Active player, action phase; target has movable property | One opponent + selected card | Opens `pending.sly_deal`, then selected property transferred | Counter chain may cancel effect |
| `forced_deal` | Active player has movable property and target has movable property | One opponent + selected swap cards | Opens `pending.forced_deal`, then swap validated/applied | Counter chain may cancel effect |
| `deal_breaker` | Target has complete set | One opponent + selected complete set color | Opens `pending.deal_breaker`, then complete set transferred | Counter chain may cancel effect |
| `just_say_no` | Pending counter response and card in hand | Source or target in counter chain | Extends counter chain; odd length cancels action, even resolves | Handled exclusively through `pending.counter` |
| `house` / `hotel` | Complete property set present | Own complete set color | Placed as building card on set | Treated as non-movable for property steal/swap |

## Ambiguous and edge interactions (implemented policy)

- Pending interaction exclusivity: only one `state.pending` can exist at a time.
- Payment selection validation:
  - If payer can cover full amount, underpayment is rejected.
  - If payer cannot cover full amount, payer must submit all available value.
- Forced deal invalid destinations revert both cards to original groups.
- Rent target must be selected by rent source player while `pending.rent` is active.
- Deal actions support property-card click selection in UI when pending selection is active.

## File pointers

- Action legality generation: `src/engine/game.ts:166`, `src/engine/game.ts:304`
- Resolution entrypoint: `src/engine/game.ts:512`
- Card catalog/action kinds: `src/cards/catalog.ts:28`
