# Spectator and Replay Hooks

## Spectator policy target

If spectator mode is introduced, spectator clients must only receive public state:

- visible table zones
- event feed
- turn/prompt metadata

Never expose hidden hand details for active players.

## Replay policy target

Replay should reuse deterministic command/event history:

- seed + players + command log as replay source
- normalized final state hash for integrity checks
- UI timeline consumers can render from event history

## Current hooks already available

- Engine history stream (`GameState.history`).
- Post-game replay timeline UI surface (`PostGameScreen`).
- Multiplayer activity/chat/event envelopes.
- Deterministic replay verifier and replay fingerprint contract (`scripts/replay_verify.mjs`, `src/replay/serialize.ts`).

## Next steps for full spectator mode

1. Define spectator room-view payload excluding private fields.
2. Add spectator auth/room admission flow.
3. Add replay export/import format tooling from completed matches.
