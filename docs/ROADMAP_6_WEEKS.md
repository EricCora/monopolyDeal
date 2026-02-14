# 6-Week Roadmap: Monopoly Deal (Local Web App)

## Baseline From Current Repo

Current implemented scope (from README + source):
- Local pass-and-play for 2-4 players
- Core Monopoly Deal action handling (rent, double rent, debt collector, birthday, property steal/swap, deal breaker, Just Say No)
- Turn enforcement (draw -> action plays <= 3 -> discard to 7 -> pass)
- Winner detection at 3 complete sets
- Auto-save/resume (`localStorage` v1), pause/resume, undo for reversible turn actions
- Stats dashboard + post-game summary + share image flow
- Test coverage across engine, storage, stats, and key UI behaviors

Implied roadmap drivers (from architecture + hotspots):
- `src/engine/game.ts` and `src/App.tsx` are high-change, high-regression modules
- Pending interaction flows are edge-case heavy
- Persistence must keep v1 compatibility unless explicitly migrated
- No explicit TODO backlog is documented in-repo, so priorities are derived from test matrix gaps, maintainability, and UX polish opportunities

## Architecture Constraints We Will Preserve

- Keep engine as source of truth (`src/engine/`)
- Preserve hard invariants: turn phase progression is valid
- Preserve hard invariants: max 3 plays/turn
- Preserve hard invariants: single exclusive pending interaction (`state.pending`)
- Preserve hard invariants: end-turn hand limit <= 7
- Preserve hard invariants: win at 3 complete sets
- Preserve hard invariants: runtime card identity format (`base#suffix`)
- Preserve storage compatibility: keep `version: 1` readable or provide explicit migration path

## Milestones

1. Rule Safety Net Expansion (Weeks 1-2)
- Increase confidence around complex pending/counter/payment branches and invalid paths.

2. Engine + App Maintainability (Weeks 3-4)
- Reduce risk in `game.ts`/`App.tsx` by extracting focused helpers without behavior regressions.

3. UX + Release Readiness (Weeks 5-6)
- Improve table clarity/accessibility and ship a stable, documented release candidate.

## Week-by-Week Plan

| Week | Goal | Deliverables | Dependencies | Risks |
|---|---|---|---|---|
| 1 | Establish quality baseline + test gap map | Test inventory doc (engine/UI/storage/stats), prioritized edge-case list, CI-ready test script checklist | Current Vitest suite stable; team time to review baseline priorities | Hidden regressions in existing edge cases may surface and slow planning |
| 2 | Strengthen engine correctness around interaction chains | New engine tests for counter/payment/rent/steal/swap invalid + recovery paths; regression checklist tied to AGENTS invariants | Clear expected behavior decisions for ambiguous card interactions | Rule ambiguity can block test writing; brittle tests if over-coupled to event text |
| 3 | Refactor engine internals safely | `src/engine/game.ts` split into focused helpers (legality/resolution utilities), unchanged public engine API, passing tests/build | Week 2 test safety net complete | Refactor drift can change legal-action generation subtly |
| 4 | Reduce App orchestration complexity | `src/App.tsx` flow extraction (screen/action helpers), improved state transition readability, focused UI tests for reveal/chooser/payment/undo/pause | Stable contracts from engine + current screen components | UI state regressions across prompt/reveal/pause combinations |
| 5 | UX/accessibility polish for core play loop | Improved prompt/action clarity, keyboard/accessibility fixes, responsive hand/table adjustments, updated UI tests | Design decisions aligned with existing tokenized theme system | Visual polish can create CSS regressions on small screens |
| 6 | Release hardening + documentation | Final test/build pass, changelog-style release notes, updated `README.md` + `docs/LLM_AGENT_GUIDE.md`, known-issues list and next backlog | Weeks 1-5 deliverables completed | Late bug fixes may force scope cuts; doc drift if changes are not captured immediately |

## Weekly Goals and Acceptance Criteria

### Week 1
- Goal: know exactly what is covered vs. risky.
- Done when we have a written gap map by module (`engine`, `App`, `ui`, `persistence`, `stats`)
- Done when we can run `npm run test`, `npm run lint`, and `npm run build` cleanly in sequence

### Week 2
- Goal: lock down rule correctness in edge flows.
- Done when new tests assert legal action presence/absence, valid mutation, and stable invalid error codes
- Done when pending flow exit conditions (`pending = null`) are verified for each relevant branch

### Week 3
- Goal: improve engine maintainability without behavior change.
- Done when `src/engine/game.ts` is decomposed into smaller, named helpers/modules
- Done when there are no public type/API breaking changes in `src/engine/types.ts` unless intentionally planned and documented

### Week 4
- Goal: simplify UI orchestration and reduce coupling.
- Done when `src/App.tsx` responsibilities are clearer (routing/state transitions/action dispatch)
- Done when existing app tests pass and targeted tests cover extracted flows

### Week 5
- Goal: polish user experience where gameplay friction is highest.
- Done when interaction prompts and action affordances are clearer in game table screen
- Done when accessibility/responsive behavior is validated in tests and manual spot checks

### Week 6
- Goal: produce a shippable, documented release candidate.
- Done when full verification pass succeeds (`test`, `lint`, `build`)
- Done when behavior changes and constraints are documented in README/LLM guide
- Done when next-phase backlog is defined from unresolved risks

## Explicit Dependency Map

- Engine changes depend on `src/engine/types.ts` union correctness
- Engine changes depend on `src/cards/catalog.ts` card metadata integrity
- App/UI changes depend on engine legal actions + prompts as source of truth
- App/UI changes depend on stable screen/component contracts in `src/ui/screens/` and `src/ui/components/`
- Persistence/stats changes depend on backward-compatible `src/persistence/storage.ts` readers
- Persistence/stats changes depend on stable record shape usage in `src/stats/`
- Release confidence depends on passing tests in `src/test/`
- Release confidence depends on clean TypeScript build and lint

## Risks and Mitigations

1. Rule regression in edge-case interactions
- Mitigation: write invalid-path and branch-exit tests before/with refactors; keep changes small.

2. Overcoupling UI logic to transient engine internals
- Mitigation: consume exported engine APIs only (`getLegalActions`, `getNextPrompt`, `applyAction`).

3. Save/stat compatibility breakage
- Mitigation: keep v1 readers tolerant; if schema changes, version + migrate + document.

4. Refactor stalls due to large files (`game.ts`, `App.tsx`)
- Mitigation: sequence extraction by responsibility; avoid mixing behavior changes with structural moves.

5. Scope creep within 6 weeks
- Mitigation: lock weekly acceptance criteria; defer non-critical enhancements to post-roadmap backlog.

## Out-of-Scope For This 6-Week Window

- Online multiplayer, backend accounts, matchmaking
- Non-local persistence services
- Major game mode additions unrelated to core pass-and-play stability
