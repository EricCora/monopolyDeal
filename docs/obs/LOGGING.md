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

## Reconnect-v1 Stub Telemetry (MD-C12)

Client-side counters:

- `multiplayer_resume_attempt`
- `multiplayer_resume_success`
- `multiplayer_resume_failure`
- `multiplayer_resync_started`
- `multiplayer_resync_completed`

Reconnect metric semantics:

- `multiplayer_resume_*` counters track each resume handshake attempt/outcome.
- `multiplayer_reconnect_success` emits once per recovered reconnect loop.
- `multiplayer_reconnect_failed` emits once per terminal reconnect loop failure (for example retry-budget exhaustion).

Server-side counters/log markers:

- `resume_request_total`
- `resume_success_total`
- `resume_failure_total`
- `disconnect_timeout_total`
- `stale_action_reject_total`
- Log markers:
  - `[mp][resume_request]`
  - `[mp][resume_result]`
  - `[mp][disconnect_timeout]`
  - `[mp][room_runtime]`
  - `[mp][action_rejected]`

`[mp][resume_result]` status taxonomy (reconnect-v1):

- `ok`
- `invalid_token`
- `seat_not_found` (reserved for forward compatibility)
- `room_closed`
- `seat_timed_out`
- `protocol_mismatch`

Redaction rule:

- Never log raw `resumeToken` values.
- Use masked token format only (for example: `ab***yz`).

Push bootstrap fallback note:

- Client applies a 5s SSE-open timeout guard.
- Server now emits an immediate `room_update` bootstrap frame (`reason=stream_bootstrap`) at stream open to avoid false idle-connect timeouts.
- If push stream bootstrap does not open in time, client transitions to polling fallback and emits:
  - `multiplayer_push_disconnected`
  - `multiplayer_push_fallback` (once per session fallback entry)

Disconnect pause/end runtime markers:

- Room runtime transitions emit structured log markers:
  - pause due to disconnect: `[mp][room_runtime] ... status=paused_disconnect`
  - auto-resume after reconnect/timeout resolution: `[mp][room_runtime] ... status=resumed_disconnect`
  - terminal timeout end: `[mp][room_runtime] ... status=ended_timeout`
- `resume_request` logs always use redacted token format via shared redaction helper.

## Boundaries

- Do not log sensitive hidden state into shared multiplayer channels.
- Keep client logs optional and bounded.
