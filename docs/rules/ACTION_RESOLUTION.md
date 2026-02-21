# Action Resolution Audit

## Resolution model

- Resolution is synchronous per command (`applyAction` clones current state and applies one command).
- Multi-step effects are represented as pending interactions and resolved through follow-up commands.
- Event output is append-only per applied action (`events` then merged into `state.history`).

## Validation enforcement

Validation occurs before mutation for most branches:

- turn/phase checks
- pending-interaction exclusivity checks
- target existence checks
- ownership and amount checks for payment/property movement

Invalid commands return stable error codes and leave caller-owned state unchanged.

## Side-effect boundary

- Engine itself is pure domain logic (no network/storage IO).
- Time fields (`createdAt`, `updatedAt`, event timestamps) are non-deterministic runtime metadata.

## Fragile/complex areas

- `applyAction` branch density and nested pending flows (`src/engine/game.ts:512`).
- Counter chain parity logic (`src/engine/game.ts` counter handling block).
- Multi-target payment continuation (`continuePaymentChain`, `src/engine/game.ts:142`).

## Recommended hardening

- Keep behavior-characterization tests before structural refactors.
- Preserve stable error-code contracts during branch extraction.
- Use replay fingerprint tests for regression detection in complex pending flows.
