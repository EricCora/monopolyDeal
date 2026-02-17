# Refactor Safety Playbook

Purpose: prevent regressions where behavior, UX details, or domain rules are unintentionally lost during refactors.

This playbook is mandatory for large changes and strongly recommended for all non-trivial edits.

## 1) Principles

1. Preserve behavior intentionally:
- Every refactor should declare what behavior must remain unchanged.

2. Test at the right level:
- Keep most coverage in fast unit/integration tests.
- Use UI/integration tests for boundaries and orchestration, not every internal detail.

3. Ship in small slices:
- Prefer short-lived branches and phased commits.
- Separate structural cleanup from behavioral changes whenever practical.

4. Keep docs in lockstep:
- A change is incomplete if user-facing or agent-facing docs are stale.

## 2) Required Workflow

### Step A: Contract Mapping (before editing)

Create a short table in your task notes or tracker:

| Area | Contract | Existing Test | Action |
| --- | --- | --- | --- |
| Example: Multiplayer payment | Valid payments accepted regardless of card click order | `src/test/multiplayer-room-service.test.ts` | Add order-insensitive regression test |

Minimum contracts to map:
- User-visible contract (screen behavior/workflow)
- Rule/invariant contract (engine/service guarantees)
- Error/recovery contract (what users see on failure)

### Step B: Characterization Coverage

If a critical behavior has no tests:
1. Add a characterization test before (or alongside) refactor edits.
2. Name tests by behavior, not implementation detail.

### Step C: Phased Implementation

Preferred commit phases:
1. Contract tests / safety net
2. Structural refactor
3. Behavior updates (if intentional)
4. Docs and release notes

### Step D: Verification Gates

Required before handoff:
1. `npm run test`
2. `npm run build`
3. `npm run lint` (document any pre-existing warnings)
4. Manual smoke checks for changed UX flows (document exact steps)

## 3) UI and Visual Regression Guardrails

For card rendering/layout/prompt choreography changes:
1. Add or update targeted UI tests in `src/test/*.test.tsx`.
2. Verify small and normal card sizes if card visuals changed.
3. Document manual checks for responsive breakpoints and multiplayer/local parity.

## 4) Documentation Sync Checklist

Update all that apply:
- `README.md` for user-visible behavior/workflow changes.
- `docs/LLM_AGENT_GUIDE.md` for architecture/workflow expectations.
- Active tracker docs for phased bug-fix efforts (for example remediation trackers/checklists).

If docs cannot be updated immediately:
- Add a clearly marked TODO with exact files/sections to update.

## 5) Pull Request / Handoff Template

Use this summary shape:

1. Behavior Contracts Preserved:
- `<contract>` verified by `<test/file>`

2. Intentional Behavior Changes:
- `<change>` with migration/UX note

3. Risk Areas:
- `<risk>` and mitigation

4. Verification:
- `npm run test`: pass/fail
- `npm run build`: pass/fail
- `npm run lint`: pass/fail (+ warnings)
- Manual smoke paths executed

## 6) References

These practices are adapted from:
- Martin Fowler, "The Practical Test Pyramid": [https://martinfowler.com/articles/practical-test-pyramid.html](https://martinfowler.com/articles/practical-test-pyramid.html)
- Google Testing Blog, "Just Say No to More End-to-End Tests": [https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html)
- Google Engineering Practices, Code Review guidance: [https://google.github.io/eng-practices/review/](https://google.github.io/eng-practices/review/)
- Trunk-Based Development (short-lived branch and incremental integration guidance): [https://trunkbaseddevelopment.com/](https://trunkbaseddevelopment.com/)
- OpenSSF Best Practices (quality/security process maturity): [https://www.bestpractices.dev/](https://www.bestpractices.dev/)
- Thoughtworks Technology Radar (ADRs): [https://www.thoughtworks.com/en-us/radar/techniques/lightweight-architecture-decision-records](https://www.thoughtworks.com/en-us/radar/techniques/lightweight-architecture-decision-records)
