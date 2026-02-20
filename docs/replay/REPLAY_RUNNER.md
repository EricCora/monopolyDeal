# Replay Runner

## Script

- Runner: `scripts/replay_verify.mjs`
- NPM alias: `npm run replay:verify`

## Usage

- Run built-in deterministic sample:

```bash
npm run replay:verify
```

- Run with replay file:

```bash
npm run replay:verify -- ./path/to/replay.json
```

## What it verifies

1. Applies replay commands from seeded initial state.
2. Computes final normalized replay fingerprint.
3. Repeats run `N` times.
4. Fails if fingerprints differ across runs.
5. Fails if `expectedFinalHash` is present and mismatched.

## Failure modes

- Invalid command in log
- Non-deterministic end-state
- Expected hash mismatch

## CI recommendation

Include this script in deterministic gate jobs for any engine rule-flow change.
