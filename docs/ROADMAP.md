# Modernization Roadmap

This roadmap is derived from:
- `docs/audit/FINDINGS_SUMMARY.md`
- `docs/features/FEATURES_CATALOG.md`
- `docs/rules/*` and `docs/replay/*`

## High impact / low effort

- Keep baseline green with `npm run quality`
- Maintain deterministic replay verification gate
- Continue valid-target highlighting and action-state clarity improvements
- Improve last-action clarity and event readability
- Keep multiplayer revision-conflict refresh behavior consistent

Acceptance:
- No quality regressions
- Replay hash checks remain stable
- UX clarity changes validated in app/multiplayer tests

## Medium effort / high value

- Incrementally extract engine validation/resolution helpers from `applyAction`
- Further split multiplayer lifecycle handling in `useMultiplayerRoom`
- Expand protocol compatibility checks/tests between shared and client types
- Add richer accessibility non-color affordances for selection states

Acceptance:
- Public engine API unchanged
- Multiplayer reconnect/resync scenarios pass expanded tests
- Accessibility checks documented and validated

## Ambitious / showcase

- Full replay export/import workflow and timeline tooling
- Spectator mode with strict public-state policy
- Adaptive AI tier with deterministic adaptation policy
- Offline-first app shell strategy

Acceptance:
- Security/integrity constraints documented and test-backed
- Feature flags + rollback paths defined for each release slice

## Execution gate

Each roadmap item lands only when:
- `npm run lint`, `npm run test`, `npm run build` pass
- docs stay synchronized in README + agent guides + tracker
