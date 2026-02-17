# Multiplayer Beta Feedback — Intake + Archive

This document is now a lightweight intake sheet.

## Current Status (2026-02-17)

The original multiplayer beta backlog was completed on branch `codex/multiplayer-beta-hardening-p0p1`.

Reference tracker:
- `docs/MULTIPLAYER_BETA_REMEDIATION_TRACKER.md`

Completed IDs from the original pass:
- `MP-GAME-01`
- `MP-GAME-02`
- `MP-GAME-03`
- `MP-UI-01`
- `MP-PAY-01`
- `MP-PAY-02`
- `MP-ROOM-01`
- `MP-ROOM-02`
- `MP-ROOM-03`
- `MP-VIS-01`
- `MP-VIS-02`
- `UX-ACTIONS-01`
- `UX-DEALS-01`
- `STAB-01`
- `MP-UX-02`
- `MP-VIS-03`
- `MP-UX-03`
- `MP-UX-04`
- `MP-RULE-01`

## New Issue Intake Template

Use this format for new bugs so future agents can execute quickly.

```md
### [ ] <ID> (<Priority>) <Title>

- Date reported: YYYY-MM-DD
- Reporter: <name>
- Mode: local | multiplayer | both
- Severity: blocker | major | minor
- Report: <what happened>
- Expected: <what should happen>
- Repro steps:
  1. ...
  2. ...
  3. ...
- Candidate areas:
  - `path/to/file.ts`
- Acceptance criteria:
  - ...
- Tests to add/update:
  - `src/test/...`
```

## Priority Legend

- `P0`: blocks progress / major break
- `P1`: significant UX/flow problem
- `P2`: polish

## Open Backlog

- None.
