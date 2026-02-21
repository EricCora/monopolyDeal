# Replay Format

Replay inputs are deterministic by combining seeded initial state + ordered command log.

## JSON schema (practical)

```json
{
  "seed": 1337,
  "runs": 3,
  "players": [
    { "id": "p1", "name": "Alpha" },
    { "id": "p2", "name": "Beta" }
  ],
  "commands": [
    { "type": "draw_cards", "playerId": "p1" },
    { "type": "pass_turn", "playerId": "p1" },
    { "type": "draw_cards", "playerId": "p2" },
    { "type": "pass_turn", "playerId": "p2" }
  ],
  "expectedFinalHash": "optional replay fingerprint"
}
```

## Required fields

- `seed`: number used by `createGame`.
- `players`: ordered `PlayerConfig[]` used at game creation.
- `commands`: ordered engine command log.

## Optional fields

- `runs`: number of repeated simulations for determinism check (default 3).
- `expectedFinalHash`: expected replay fingerprint for assertion.

## Replay final hash contract

- Final hash is generated from a normalized state snapshot:
  - `createdAt`, `updatedAt`, and event timestamps are normalized to zero.
- Hash algorithm: deterministic FNV-1a 32-bit over stable JSON serialization.
- Implementation: `src/replay/serialize.ts`.
