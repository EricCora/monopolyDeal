# ADR-0000: Baseline and Guardrails for Full Audit Modernization

- Status: Accepted
- Date: 2026-02-20
- Owners: Repo maintainers / Codex execution agent

## Context

The modernization program starts from an advanced codebase, not a greenfield app. Prior to broad refactors, the baseline had:

- One failing multiplayer UI test
- Lint errors in multiplayer room/screen code
- Large architecture docs and roadmap overlap risk

We need a stable quality baseline and lightweight governance before running multi-stage changes.

## Decision

1. Stage order is fixed to begin with baseline recovery and guardrails.
2. Quality gate command is standardized as `npm run quality` (`lint` -> `test` -> `build`).
3. Documentation strategy is lean and linked (avoid duplicate long-form copies).
4. Existing deep-research tracker is superseded by a staged implementation tracker, while preserving history in an appendix.
5. Core architecture defaults are locked for this program:
- Engine stays pure and deterministic.
- UI remains a consumer of engine state/actions.
- Multiplayer remains server-authoritative.

## Consequences

- We gain a reliable foundation for staged delivery and regression control.
- Future PRs have explicit guardrails and quality expectations.
- Some existing warning-level lint output remains (TanStack table compatibility) and is tracked as non-blocking unless it becomes user-visible.

## Follow-up requirements

- Every stage update must refresh `docs/IMPLEMENTATION_TRACKER.md`.
- Non-trivial architecture changes require a new ADR under `docs/adr/`.
- Behavior changes must update `README.md` and `docs/LLM_AGENT_GUIDE.md` in the same change set.
