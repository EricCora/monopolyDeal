# Multiplayer Concessions Log

This file records explicit tradeoffs made to ship flagship multiplayer improvements safely.

## Concession Entries

### C-001: Keep REST mutations, add push as a bridge
- Decision: keep existing REST mutation endpoints and add server-push for revision notifications.
- Why: lower migration risk, preserve server-authoritative behavior, and keep rollback simple.
- Impact: some latency remains if push is unavailable; polling fallback handles resilience.
- Exit criteria: only move to full socket transport when push metrics justify migration.

### C-002: No account system in flagship phase
- Decision: keep identity ephemeral (display name + room session token).
- Why: avoid auth complexity while prioritizing reliability and onboarding.
- Impact: no persistent social graph or friend list.
- Exit criteria: introduce auth only when public matchmaking/social persistence is prioritized.

### C-003: Private room flow remains primary
- Decision: optimize private invites before public matchmaking.
- Why: strongest immediate UX gain for small-group play and lower operational burden.
- Impact: no quick-play queue in this phase.
- Exit criteria: introduce queue/discovery when active user volume supports matching quality.

### C-004: Preset reactions only
- Decision: implement fixed quick reactions, not free-text chat.
- Why: avoid moderation and abuse complexity.
- Impact: social communication is lightweight but constrained.
- Exit criteria: reassess when moderation and reporting pipeline exists.

### C-005: Feature-flagged rollout
- Decision: ship push and reactions behind both UI and server switches.
- Why: preserve rapid rollback path for multiplayer stability incidents.
- Impact: multiple operational states to test (`live`, `fallback`, `disabled`).
- Exit criteria: remove flags only after sustained stability and telemetry confidence.
