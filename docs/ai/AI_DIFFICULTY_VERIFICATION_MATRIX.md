# AI Difficulty Verification Matrix

This matrix defines deterministic verification expectations for currently shipped AI behavior.

## Scope

- Tier coverage: heuristic (`easy`), rollout (`hard`), and coach hint output for both.
- Determinism target: fixed rollout seed must produce repeatable command decisions.
- Safety target: all AI outputs must remain legal engine commands.

## Scenario Matrix

| Scenario ID | Prompt context | Expected invariants | Test reference |
| --- | --- | --- | --- |
| `action-rent-pressure` | Main action phase | Easy and hard both choose legal commands; hard deterministic with fixed seed | `src/test/ai-tier-matrix.test.ts` |
| `counter-response-window` | Counter response pending | Easy and hard outputs remain legal in response window | `src/test/ai-tier-matrix.test.ts` |
| `forced-deal-selection` | Selection pending | AI outputs remain legal in selection prompts | `src/test/ai-tier-matrix.test.ts` |
| `payment-prompt` | Payment pending | AI output remains legal and actionable in payment resolution prompts | `src/test/ai-tier-matrix.test.ts` |

## Contract Checks

- `src/test/ai-contract.test.ts`
  - Heuristic legality across action/payment/selection scenarios.
  - Rollout determinism for fixed seeds across scenario table.
  - Rollout legality under varied seeds.
  - Coach hint easy/hard output must be non-empty and map to legal action labels.

- `src/test/determinism.test.ts`
  - Engine-state deterministic replay and fingerprint invariants remain stable.

- `src/test/replay.test.ts`
  - Replay format and serialized-state compatibility checks remain green.

## Difficulty Knob Expectations

| Mode | Selection strategy | Determinism expectation | User-facing expectation |
| --- | --- | --- | --- |
| `easy` | Heuristic ranking (`chooseHeuristicAction`) | Deterministic for a fixed state | Fast, readable decisions |
| `hard` | Monte Carlo rollout (`chooseMonteCarloAction`) | Deterministic for fixed state + fixed rollout seed | Stronger tactical choices, bounded compute |
| `coach` easy/hard | `buildCoachHint` over legal actions | Stable actionable label + rationale for fixed inputs | Non-empty guidance tied to legal commands |

## Exit Gate for AI Stage Closure

- `npm run test -- src/test/ai-contract.test.ts src/test/ai-tier-matrix.test.ts src/test/determinism.test.ts src/test/replay.test.ts`
