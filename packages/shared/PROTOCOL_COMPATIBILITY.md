# Multiplayer Protocol Compatibility Notes

Scope: contracts in `packages/shared/multiplayer.ts` and client mirror types in `src/network/multiplayerTypes.ts`.

## Compatibility policy

1. Additive fields are preferred.
2. Never remove or rename wire fields without a documented migration path.
3. Keep server responses backward-compatible for older clients where practical.
4. Error codes are API contracts; avoid semantic drift in existing codes.

## Change checklist

- Update shared contract types in `packages/shared/multiplayer.ts` first.
- Mirror changes in `src/network/multiplayerTypes.ts`.
- Update server serializer/endpoint responses in `apps/server/src/index.ts` + `apps/server/src/gameService.ts`.
- Add or update client parsing tests in `src/test/multiplayer-client.test.ts`.
- Add or update room-service behavior tests in `src/test/multiplayer-room-service.test.ts`.

## Revisioning rules

- `revision` increments on every mutating room operation.
- Client mutations should include `expectedRevision`.
- `revision_conflict` must not mutate room state.

## Recovery rules

- Clients should refresh room state on `revision_conflict`.
- Stale/expired sessions should be explicitly cleared with user-facing recovery notice.
