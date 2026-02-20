# Multiplayer Security and Integrity

## Trust boundaries

- Clients are untrusted.
- Server validates session identity, reconnect window, revision, and legal actions.

## Hidden information policy

- Active clients only receive room-view summaries for other players (hand counts, not hand contents).
- Future spectator mode must preserve this hidden-info boundary.

## Validation rules

- Session token validation per player/room.
- Expected revision checks for mutating endpoints.
- Action legality enforced server-side against current room state.
- Host-only guards for room-admin operations.

## Anti-cheat basics

- Reject illegal or stale revision commands.
- Rate-limit social endpoints (chat/reactions).
- Keep authoritative game state server-side.

## Integrity UX

- Surface reconnect and recovery notices to users.
- Refresh on revision conflicts.
- Provide clear paths to recover (`Refresh`, `Exit Match`, `Forget Room`).

## Next hardening steps

- Add endpoint-level audit logging for repeated invalid action attempts.
- Add stricter payload schema validation at server edge.
