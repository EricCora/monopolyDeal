# Multiplayer Beta Remediation Tracker

Branch: `codex/multiplayer-beta-hardening-p0p1`  
Source checklist: `docs/BETA_MULTIPLAYER_BUGS_CHECKLIST.md`

## Scope

This pass now includes full prioritized multiplayer hardening across **P0/P1/P2** checklist items.

## Decision Log

- `2026-02-16`: `Leave Room` behavior for active matches should default to **Exit + keep reconnect capability**.
- `2026-02-16`: Keep strict engine invariants unchanged; fix multiplayer issues via server legality normalization + UI/flow cleanup rather than bypassing rules.
- `2026-02-17`: Post-checkpoint QA regressions should be tracked as explicit follow-up fixes (with tests), not silent polish edits.

## Phase Checklist

- [x] Phase 0: Branch created + tracker scaffolded.
- [x] Phase 1: Gameplay/UI blockers
  - [x] MP-GAME-01 chooser/prompt sync
  - [x] MP-GAME-02 multiplayer winner overlay
  - [x] MP-UI-01 rules drawer accessible in multiplayer
- [x] Phase 2: Payment correctness and quality
  - [x] MP-PAY-01 order-insensitive manual payment legality
  - [x] MP-PAY-02 improve auto-select payment choices
- [x] Phase 3: Lifecycle/UX
  - [x] MP-ROOM-01 exit vs forget flow
  - [x] MP-GAME-03 in-match per-player connection status clarity
  - [x] UX-ACTIONS-01 de-emphasize exhaustive legal action list
- [x] Phase 4: Stability
  - [x] STAB-01 blank-screen hardening path coverage
- [x] Phase 5: Documentation and release notes alignment
- [x] Phase 6: P2 completion pass
  - [x] MP-ROOM-02 original host preference on reconnect
  - [x] MP-ROOM-03 lobby resume-from-checkpoint flow
  - [x] MP-VIS-01 compact rent readability polish
  - [x] MP-VIS-02 rent action card rent clarity
  - [x] UX-DEALS-01 click-driven deal/swap selection
- [x] Phase 7: Post-checkpoint QA regressions
  - [x] MP-UX-02 multiplayer advanced legal actions toggle now opens/closes list
  - [x] MP-VIS-03 hand rent card summary removes cluttered mini-boxes
  - [x] MP-UX-03 advanced legal actions list uses ordered numbering
  - [x] MP-UX-04 action labels colorize property tokens in chooser/debug contexts

## Verification Log

- `2026-02-16`: Baseline before changes
  - `npm run test` passed (`108` tests)
  - `npm run build` passed
- `2026-02-16`: Targeted hardening suites after implementation
  - `npm run test -- src/test/multiplayer-room-service.test.ts src/test/multiplayer-client.test.ts src/test/engine.test.ts src/test/app.test.tsx` passed (`86` tests)
- `2026-02-16`: Final verification
  - `npm run test` passed (`115` tests)
  - `npm run build` passed
  - `npm run lint` passed with one existing warning in `src/ui/components/StatsDashboard.tsx` (`react-hooks/incompatible-library` from `useReactTable`)
- `2026-02-16`: P2 completion verification
  - `npm run test` passed (`123` tests)
  - `npm run build` passed
  - `npm run lint` passed with one existing warning in `src/ui/components/StatsDashboard.tsx` (`react-hooks/incompatible-library` from `useReactTable`)
- `2026-02-17`: Post-checkpoint regression verification
  - `npm run test -- src/test/app.test.tsx src/test/card-ui.test.tsx` passed (`51` tests)
  - `npm run build` passed
  - `npm run lint` passed with one existing warning in `src/ui/components/StatsDashboard.tsx` (`react-hooks/incompatible-library` from `useReactTable`)
- `2026-02-17`: Action-label clarity follow-up verification
  - `npm run test -- src/test/play-chooser.test.tsx src/test/app.test.tsx src/test/card-ui.test.tsx` passed (`52` tests)
  - `npm run build` passed
  - `npm run lint` passed with one existing warning in `src/ui/components/StatsDashboard.tsx` (`react-hooks/incompatible-library` from `useReactTable`)

## Deferred Backlog

- None from `docs/BETA_MULTIPLAYER_BUGS_CHECKLIST.md` as of `2026-02-16`.
