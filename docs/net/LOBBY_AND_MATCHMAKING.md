# Lobby and Matchmaking Model

Current scope is private-room session flow (no public queue).

## Lobby states

- `lobby`: host/join, ready toggles, room controls
- `active`: match running with in-table multiplayer controls
- `finished`: match complete state with exit/forget options

## Invite and join flow

- Host creates room and gets room code/session token.
- Invite link supports deep route `/join/:roomCode`.
- Join path supports direct room-code entry and reconnect.

## Seat and presence policy

- Lobby disconnect seats are reclaimed promptly.
- Active/finished matches keep reconnect windows for continuity.
- Host migration is automatic when host disconnects.

## Rematch and checkpoint flow

- Host may start match from lobby or from compatible checkpoint.
- Checkpoint start requires participant lineup compatibility.

## Future matchmaking extension points

- Public room discovery (out of current scope)
- Private invite expiration controls
- Optional match presets in lobby creation payload
