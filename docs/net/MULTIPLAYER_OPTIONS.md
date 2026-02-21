# Multiplayer Architecture Options

## Option A (Selected): Server-authoritative

- Clients send commands only.
- Server validates and applies commands.
- Server broadcasts state-change events and serves room snapshots.

Why selected:
- Best fit for hidden information integrity.
- Existing implementation already follows this model.
- Strongest anti-cheat baseline for this repo scope.

## Option B (Not selected): Deterministic lockstep

- All clients run full engine and exchange commands.
- Requires strict deterministic parity and robust desync reconciliation.

Tradeoffs:
- Lower server cost, but significantly higher client consistency burden.
- Harder to protect hidden hand data.

## Option C (Not selected): Host-authoritative P2P

- One client acts as host authority.

Tradeoffs:
- Lower backend cost, but weaker reliability and fairness.
- Host churn/quality significantly affects match stability.

## Migration stance

No architecture pivot planned. Continue hardening Option A with:
- protocol compatibility guards
- reconnect/resync improvements
- replay/event stream consistency
