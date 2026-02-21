# Replay Debugging

## Workflow

1. Capture deterministic replay input (seed + players + command log).
2. Run replay verifier (`npm run replay:verify -- <file>`).
3. Compare final fingerprint against expected baseline.
4. If mismatch, bisect command index and inspect branch behavior in `applyAction`.

## Tooling

- Runner: `scripts/replay_verify.mjs`
- Serializer/fingerprint: `src/replay/serialize.ts`
- Tests: `src/test/replay.test.ts`, `src/test/determinism.test.ts`

## CI recommendation

Run replay verification for engine-affecting PRs to catch nondeterministic regressions early.
