# Lobby and Matchmaking Model

Current scope is private-room session flow (no public queue).

## Lobby states

- `lobby`: host/join, ready toggles, preset selection, room controls
- `active`: match running with in-table multiplayer controls
- `finished`: match complete state with exit/forget options and same-room rematch

## Invite and join flow

- Host creates room and gets room code/session token.
- Invite link supports deep route `/join/:roomCode`.
- Join path supports direct room-code entry and reconnect.
- Browser-local recovery now shows one `Resume Your Room` surface when this profile still has valid seat credentials for a live room.
- The recovery model is intentionally collection-ready even though the current UI only surfaces one resumable room; future recent/joined-room recovery should extend this registry instead of replacing it.

## Seat and presence policy

- Lobby disconnect seats are reclaimed promptly.
- Active/finished matches keep reconnect windows for continuity.
- Host migration is automatic when host disconnects.

## Preset and readiness policy

- Every room carries a host-selected preset: `standard` (default), `fast`, or `teaching`.
- Presets are additive room metadata; ruleset selection still flows through the existing engine `GameConfig.ruleset`.
- `fast` changes the win condition to 2 complete sets.
- `teaching` uses the standard ruleset and only changes guidance/support copy.
- Lobby ready state is a real consent gate: host start is allowed only when at least two players are connected and every connected player is ready for the selected preset.
- Changing the preset clears all ready flags so the room reconfirms the active setup.

## Rematch and checkpoint flow

- Host may start match from lobby or from compatible checkpoint.
- Finished rooms may start a same-room rematch with the same roster, host, and selected preset.
- Rematch is host-only and requires every current room player to be connected and marked ready.
- Checkpoint start requires participant lineup compatibility.
- Checkpoint start also requires ruleset compatibility with the selected preset; `standard` and `teaching` share a ruleset, while `fast` must match a 2-set checkpoint.

## Match history and stats

- Finished multiplayer rooms write a shared match-history record alongside local games.
- History entries include additive session metadata: `mode`, `surface`, optional `presetId`, and optional `roomCode`.
- Completion recording is deduped so reconnect/resync does not double-count the same finished room.

## Future matchmaking extension points

- Public room discovery (out of current scope)
- Private invite expiration controls
- Async room variants and watch-seat/spectator flows
