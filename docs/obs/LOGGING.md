# Logging and Tracing

## Current signals

- Engine emits structured event entries in `GameState.history`.
- Multiplayer server appends activity feed entries and room revision updates.
- Growth metrics track multiplayer funnel/push outcomes and feature engagement.

## Logging goals

- Correlate command attempts, revision changes, and reconnect outcomes.
- Keep logs user-safe (no hidden hand data leakage).
- Enable rapid bug reproduction with replay inputs.

## Recommended additions

1. Add action correlation IDs for multiplayer mutation calls.
2. Add bounded in-memory ring buffer export in dev mode.
3. Add explicit revision conflict/recovery counters in telemetry.

## Boundaries

- Do not log sensitive hidden state into shared multiplayer channels.
- Keep client logs optional and bounded.
