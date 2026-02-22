# Modernization Roadmap

This roadmap is derived from:
- `docs/audit/FINDINGS_SUMMARY.md`
- `docs/features/FEATURES_CATALOG.md`
- `docs/rules/*` and `docs/replay/*`

Current status (2026-02-22):
- Program baseline and staged modernization roadmap are complete.
- Epic C reconnect/resume hardening is complete through MD-C12.
- Stage 5 AI deterministic verification matrix and difficulty checks are complete.
- Final closure mapping is published in `docs/PROGRAM_CLOSURE.md`.

## Completed Program Outcomes

- Multiplayer reconnect/resume contract, handshake statuses, and authoritative resync flow.
- Disconnect grace retention, runtime pause/end policy, and host-timeout terminal behavior.
- State-version stale-action guard with auto-resync and duplicate-action idempotency.
- Live-updates bootstrap reliability with polling fallback safety.
- Reconnect telemetry and dev diagnostics with token-safe logging.
- Expanded reconnect/resync automation coverage across service/hook/screen/app tests.
- AI deterministic tier matrix coverage and documented verification references.

## Ongoing Maintenance Track

- Keep quality gates green on each release slice:
  - `npm run lint`
  - `npm run test`
  - `npm run build`
  - `npm run replay:verify`
- Preserve compatibility until dedicated deprecation cleanup:
  - legacy reconnect identity aliases (`playerId`/`sessionToken`)
- Continue incremental ergonomics improvements without changing core rules invariants.

## Future Backlog (Post-Closure)

- Spectator/replay export workflow and public-state policy hardening.
- Optional adaptive AI tier with deterministic adaptation constraints.
- Additional real-device network chaos validation for multiplayer transport behavior.
