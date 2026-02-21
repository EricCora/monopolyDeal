# Full Audit + Modernization Implementation Tracker

This tracker supersedes the prior deep-research execution tracker and follows:
`docs/plan_monopoly_deal_digital_full_audit_modernization_all_phases_in_one_document.md`.

## Program Defaults

- Stage priority: stability first
- Documentation strategy: lean + linked
- Architecture defaults: pure engine, UI consumer, server-authoritative multiplayer
- Compatibility: keep persistence payloads `version: 1` backward-readable

## Status Snapshot (2026-02-20)

- Program status: `in_progress` (major multi-stage progress completed; full modernization not fully closed yet).
- Completed recently:
  - Major table/lobby UI modernization pass (command strip, priority turn banner, grouped controls, lobby snapshot cards, turn tagging).
  - Payment-flow unblock fix for zero-asset Debt Collector/payment shortfall confirmation.
  - Multiplayer reconnect/desync validation hardening and targeted regression coverage.
  - Rules/replay/determinism artifacts and tests in place.
- Remaining to close full program:
  - Stage 4: additional multiplayer hardening scenarios and migration closure docs.
  - Stage 5: deeper AI contract/regression expansion beyond baseline deterministic coverage.
  - Stage 6: final roadmap closure tying remaining findings to acceptance criteria.

## Stage Checklist

### Stage 0 — Baseline Recovery + Guardrails

- [x] Fix failing multiplayer copy-notice test flow
- [x] Fix lint errors (`no-unsafe-finally`, `set-state-in-effect`)
- [x] Add guardrail scripts under `scripts/`
- [x] Add baseline docs and ADR
- [x] Run final Stage 0 full gate (`npm run quality`)

Artifacts:
- `docs/BASELINE.md`
- `docs/adr/ADR-0000-baseline-and-guardrails.md`
- `scripts/print_tree.mjs`
- `scripts/run_quality.mjs`
- `scripts/run_e2e.mjs`

### Stage 1 — Architecture + Data Flow Audit Pack

- [x] `docs/audit/REPO_MAP.md`
- [x] `docs/audit/ARCHITECTURE.md`
- [x] `docs/audit/STATE_MANAGEMENT.md`
- [x] `docs/audit/NETWORKING.md`
- [x] `docs/audit/GAME_LOOP.md`
- [x] `docs/audit/UI_RENDERING.md`
- [x] `docs/audit/SEPARATION_AND_EVENTS.md`
- [x] `docs/audit/FINDINGS_SUMMARY.md`

### Stage 2 — Rules Matrix + Determinism + Replay

- [x] `docs/rules/RULES_MATRIX.md`
- [x] `docs/rules/TURN_STATE_MACHINE.md`
- [x] `docs/rules/ACTION_RESOLUTION.md`
- [x] `docs/rules/EFFECT_MODEL.md`
- [x] `docs/replay/REPLAY_FORMAT.md`
- [x] `docs/replay/REPLAY_RUNNER.md`
- [x] `scripts/replay_verify.mjs`
- [x] `src/test/replay.test.ts`
- [x] `src/test/determinism.test.ts`

### Stage 3 — UX Clarity + Modernization Quick Wins

- [x] Ship/harden playable + target feedback flows
- [x] Ship/harden pending action-state banner behavior
- [x] Ship/harden payment clarity messaging
- [x] Ship/harden event readability improvements
- [x] Validate touch hit targets/mobile layout behavior
- [x] `docs/ux/UX_AUDIT.md`
- [x] `docs/ux/UX_IMPROVEMENTS_BACKLOG.md`
- [x] Update `README.md` and `docs/LLM_AGENT_GUIDE.md`

### Stage 4 — Multiplayer Architecture Hardening

- [x] `docs/net/MULTIPLAYER_AUDIT.md`
- [x] `docs/net/MULTIPLAYER_OPTIONS.md`
- [x] `docs/net/LOBBY_AND_MATCHMAKING.md`
- [x] `docs/net/SPECTATOR_AND_REPLAY.md`
- [x] Harden reconnect/resync/error handling paths (baseline complete)
- [x] Tighten server payload/action validation boundaries (baseline complete)
- [x] Add protocol compatibility notes for `packages/shared`
- [x] Add reconnect/desync test coverage (baseline complete)
- [x] Add push/poll reconnect-desync end-to-end matrix (baseline complete)
- [ ] Close remaining expanded reconnect/revision-conflict edge scenarios
- [ ] Finalize Stage 4 migration closure notes

### Stage 5 — AI System Consolidation

- [x] `docs/ai/AI_ARCHITECTURE.md`
- [x] `docs/ai/AI_TIERS.md`
- [x] Enforce AI output contract: engine commands only (baseline complete)
- [x] Add deterministic AI regression tests (baseline complete)
- [ ] Expand tier-by-tier deterministic regression matrix
- [ ] Finalize documented difficulty knob verification matrix

### Stage 6 — Eng + Obs + Security + Final Roadmap

- [x] `docs/eng/REFACTOR_STRATEGY.md`
- [x] `docs/eng/TEST_STRATEGY.md`
- [x] `docs/eng/PERFORMANCE_PLAN.md`
- [x] `docs/eng/OFFLINE_FIRST.md` (optional)
- [x] `docs/obs/LOGGING.md`
- [x] `docs/obs/REPLAY_DEBUGGING.md`
- [x] `docs/obs/FEATURE_FLAGS.md`
- [x] `docs/security/MULTIPLAYER_SECURITY.md`
- [x] `docs/ROADMAP.md` (baseline)
- [ ] Publish final roadmap closure mapping remaining findings to acceptance gates

## Exit Gates (Program)

- [x] `npm run lint` has zero errors
- [x] `npm run test` passes
- [x] `npm run build` passes
- [x] Deterministic replay hash verification passes across repeated runs
- [x] Documentation set is internally linked and non-duplicative
- [ ] Final program closure package published (all stages fully closed)

---

## Appendix A — Legacy Tracker Snapshot (Preserved)

This is retained from the previous tracker for historical continuity.

### Prior workstream checklist

- [x] Import deep research plan into repo
- [x] Add execution tracker and phased commit log
- [x] Add novice-friendly experimental settings flags
- [x] Expand engine edge-case tests
- [x] Refactor engine internals into clearer helpers
- [x] Refactor App orchestration boundaries
- [x] Add contextual action previews and richer event grouping
- [x] Improve accessibility (keyboard + SR announcements + contrast)
- [x] Add game-feel improvements (motion/sound/haptics controls)
- [x] Add bot-capable setup model and auto-turn bot execution
- [x] Add heuristic AI + rollout AI + explainable AI coach panel
- [x] Add replay timeline mode from completed matches
- [x] Add achievements and daily challenge seed workflow
- [x] Add LAN multiplayer server/client architecture (room code flow)
- [x] Replace manual LAN setup UX with one-click hosted multiplayer room flow
- [x] Upgrade multiplayer to rich in-match table parity with host controls and server-authoritative snapshots
- [x] Add custom rules/ruleset support + safe card-pack extension points
- [x] Expand analytics and release documentation

### Prior commit log

- `fe1702c` docs: add deep research improvement plan for implementation tracking
- `d08e212` feat(settings): add experimental feature flags and accessibility toggles
- `fa4dcac` feat(ai): add bot setup, coach hints, and replay timeline surfaces
- `552a054` feat(core): add retention systems, custom ruleset plumbing, and LAN multiplayer scaffold
- `006cc50` feat(accessibility+rules): extend custom-rules coverage and polish assistive UX
- `8b9a357` refactor(engine): extract core helpers and broaden pending-flow regression coverage
- `ebad365` feat(app+analytics): add orchestration hooks and growth telemetry insights
- `2230360` feat(multiplayer): ship one-click hosted room flow with reconnect and host migration
- `c731c3b` feat(multiplayer): ship rich in-match parity with host controls and revision-safe room actions
