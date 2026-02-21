# PLAN — Monopoly Deal Digital: Full Technical Audit + Ambitious Modernization (All Phases)

> **Audience:** Codex / LLM agent with direct repo access
>
> **Goal:** Perform a deep technical audit of the Monopoly Deal digital implementation and deliver an ambitious, high-impact modernization roadmap with execution-ready instructions.
>
> **Core constraints**
> - Preserve Monopoly Deal rules unless explicitly extending later.
> - Favor deterministic, testable logic.
> - Prioritize clarity and maintainability over cleverness.
> - UI modernization must **not require rewriting the game engine**.
> - Use small, reviewable PR-sized changes.

---

## How to use this document (Codex operating instructions)
1. **Audit first, then change.** Complete Phase 0–2 artifacts before major refactors.
2. Work in **small PR-sized increments** with clear commit messages.
3. Treat the **engine as pure** (no hidden mutation, no UI side-effects in reducers).
4. Treat **UI as a consumer** of engine state and events.
5. Any non-trivial architectural decision requires an **ADR** under `docs/adr/`.
6. Every PR must include:
   - Updated docs (if relevant)
   - Tests or explicit rationale
   - Replay verification (where applicable)

---

# Phase 0 — Baseline, Tooling, and Guardrails

## 0.1 Baseline scripts (no functional changes)
- Add `scripts/` utilities:
  - `scripts/print_tree.(sh|js)` → repo tree snapshot
  - `scripts/run_quality.(sh|js)` → lint + typecheck + tests
  - `scripts/run_e2e.(sh|js)` → e2e/smoke if available
- Create `docs/BASELINE.md`:
  - how to run app (dev/prod)
  - how to run tests, lint, build
  - supported node version
  - env vars and defaults
  - multiplayer local setup steps (if present)

## 0.2 Determinism switches (required)
- Introduce one config entry (env or settings) that forces:
  - deterministic RNG (seeded)
  - deterministic shuffles
  - deterministic AI (seeded)
- If already present, document it.

## 0.3 Minimal smoke test harness
- If no tests exist:
  - Add 1 engine test: “create game → start game → first turn valid”.
  - Add 1 UI smoke: “render game table without crashing”.

**Deliverables**
- `docs/BASELINE.md`
- `docs/adr/ADR-0000-baseline-and-guardrails.md`
- Scripts added under `scripts/`

**Acceptance**
- One command runs lint/typecheck/tests.
- Deterministic seed path is documented.

---

# Phase 1 — Codebase Understanding (Architecture + Data Flow Audit)

> This phase produces documentation and risk analysis, not refactors.

## 1.1 Repository structure mapping
Create `docs/audit/REPO_MAP.md`:
- High-level tree (top 2–3 levels)
- Identify directories:
  - engine / rules
  - UI
  - networking
  - storage (stats/history)
  - AI
  - assets
  - tests
- Build tooling overview (bundler, tsconfig, lint, test runner)

## 1.2 Architecture pattern identification
Create `docs/audit/ARCHITECTURE.md`:
- UI pattern (component-driven, Redux-ish, MVVM-ish, etc.)
- Engine separation (clean boundary vs entangled)
- Side-effect handling location (network, storage, timers)

Include a simple diagram (ASCII is OK):
- UI → selectors/view-model → engine state
- user actions/commands → validation → reducer/state machine → events
- adapters: networking/persistence boundaries

## 1.3 State management approach
Create `docs/audit/STATE_MANAGEMENT.md`:
- Global store choice (Redux/Zustand/context/custom)
- Engine state ownership (single source vs fragmented)
- Derived state computation (selectors vs computed in render)
- UI state location (modals, prompts, selections, animations)
- Known hazards:
  - duplicated truth
  - mutation risk
  - re-render storms

## 1.4 Networking model (if present)
Create `docs/audit/NETWORKING.md`:
- Transport (WebSocket/WebRTC/HTTP)
- Authority model (server/host/lockstep)
- Message types and payload shapes
- Sync strategy (full snapshot vs events vs command replication)
- Reconnection & recovery
- Latency handling (optimistic vs authoritative)

## 1.5 Game loop & rules engine implementation
Create `docs/audit/GAME_LOOP.md`:
- Turn start trigger
- Draw step handling
- “play up to N cards” enforcement
- Action resolution pipeline (immediate, queued, stacked)
- Illegal move prevention (validate-first vs apply/rollback)

## 1.6 UI rendering approach
Create `docs/audit/UI_RENDERING.md`:
- Component tree hotspots
- Card rendering method (HTML/SVG/canvas/images)
- Layout method (grid/flex/breakpoints)
- Animation approach (library vs CSS)
- Accessibility baseline

## 1.7 Separation of concerns & event/data flow
Create `docs/audit/SEPARATION_AND_EVENTS.md`:
- Boundaries: engine domain vs UI vs adapters
- Event model (callbacks, event bus, effects middleware)
- Suspected race conditions:
  - simultaneous network events + local commands
  - timer-based transitions
  - animation completion mutating engine state
  - persistence writes during transitions

## 1.8 Findings summary
Create `docs/audit/FINDINGS_SUMMARY.md`:
- Strengths
- Technical debt
- Scalability limits
- Bug/race risk list (severity-ordered)

**Acceptance**
- A new engineer can explain how the app works end-to-end from the docs.

---

# Phase 2 — Game System & Rules Engine Review (Correctness + Extensibility + Determinism)

## 2.1 Rules correctness & edge-case matrix
Create `docs/rules/RULES_MATRIX.md`:
- For each card/effect:
  - prerequisites
  - targets
  - resolution steps
  - cancellation/counter rules (e.g., Just Say No)
  - ambiguous interactions
- Edge cases:
  - multi-payer effects
  - steal from incomplete sets
  - wildcard assignment + rent color selection
  - bank payment selection ordering
  - deck depletion behavior (if implemented)

## 2.2 Turn state machine robustness
Create `docs/rules/TURN_STATE_MACHINE.md`:
- Enumerate states (example):
  - `TURN_START`, `DRAWING`, `ACTION_SELECTION`, `CHOOSING_TARGET`, `PAYMENT_SELECTION`, `RESOLVING`, `TURN_END`, `GAME_OVER`
- Transitions + guards
- State invariants

Optional: Mermaid diagram if repo supports it.

## 2.3 Action resolution logic audit
Create `docs/rules/ACTION_RESOLUTION.md`:
- Sync vs queued resolution
- Validation enforcement location
- Identify any side effects inside state transitions (bad for determinism)
- List ambiguous/fragile logic with file pointers

## 2.4 Modularize card effects (recommended target design)
Create `docs/rules/EFFECT_MODEL.md`:
- **Command model** (player intent):
  - `PLAY_CARD`, `CHOOSE_TARGET`, `PAY`, `RESPOND_COUNTER`, `END_TURN`
- **Validation layer** (pure): `validate(state, command)`
- **Reducer/state machine** (pure): `reduce(state, command) -> { nextState, events }`
- **Event stream** (append-only): `GameEvent[]` for UI + logs + replay

Recommended structure:
- `effects/definitions/*` (data and simple resolvers)
- `effects/resolvers/*` (complex effects)
- `rules/validators/*`

## 2.5 Deterministic simulation & replay foundations
Create:
- `docs/replay/REPLAY_FORMAT.md`:
  - seed
  - initial deck order OR seed-based deck generation spec
  - ordered command log
  - final hash
- `docs/replay/REPLAY_RUNNER.md`:
  - re-simulate deterministically
  - verify final hash
- Optional tool: `scripts/replay_verify.(ts|js)`

**Acceptance**
- Replay verification yields identical final hash across runs.

---

# Phase 3 — UX & Game Feel Evaluation (Flow, Clarity, Responsiveness)

## 3.1 UX audit
Create `docs/ux/UX_AUDIT.md`:
- onboarding
- turn flow clarity
- action selection clarity
- targeting & payment flows
- error prevention + recovery
- perceived performance
- accessibility gaps

Include:
- Top 10 friction points
- Top 10 delight opportunities
- Priority accessibility issues

## 3.2 Implementable UX backlog
Create `docs/ux/UX_IMPROVEMENTS_BACKLOG.md`:
- Each item includes: problem, impact, solution, effort (S/M/L), dependencies, acceptance criteria

Must include:
- Playable card highlighting + “what can I do now?” guidance
- Action state banners (“Choose a target”, “Select payment”, “Waiting”)
- Payment flow clarity (how much owed, what’s selectable, overpay warnings)
- Event log clarity + “last action” panel
- Home/menu microcopy improvements (saved vs resumed)
- “How to play” CTA/tutorial entry point

---

# Phase 4 — Multiplayer & Networking Architecture

## 4.1 Multiplayer audit
Create `docs/net/MULTIPLAYER_AUDIT.md`:
- diagram current architecture
- authority model
- sync model
- reconnect flow
- failure modes

## 4.2 Production-grade architecture options
Create `docs/net/MULTIPLAYER_OPTIONS.md` with tradeoffs:

Option A — **Server authoritative** (recommended)
- Clients send commands
- Server validates + applies
- Server broadcasts events/snapshots

Option B — **Deterministic lockstep**
- All clients run same deterministic engine
- Exchange commands, detect desync

Option C — **Host authoritative P2P**
- One client is authoritative host

For each option include:
- message schema
- resync strategy
- reconnect UX
- cross-network feasibility

## 4.3 Lobby, matchmaking, spectator, replay hooks
Create `docs/net/LOBBY_AND_MATCHMAKING.md`:
- lobby states, invite flows, room codes/links
- rematch flow

Create `docs/net/SPECTATOR_AND_REPLAY.md`:
- spectator sees public state only
- replay uses the same event stream

**Acceptance**
- A clear choice + migration plan exists.

---

# Phase 5 — AI Opponents & Decision Systems

## 5.1 AI architecture
Create `docs/ai/AI_ARCHITECTURE.md`:
- AI reads engine state via stable interface
- AI outputs **Commands** (same as humans)
- AI is deterministic given seed + history

## 5.2 AI tiers
Create `docs/ai/AI_TIERS.md`:

Tier 1 — Heuristic
- complete sets
- bank sensibly
- disrupt near-wins

Tier 2 — Weighted strategy
- score candidate moves with weights
- difficulty = different weights + injected noise

Tier 3 — Monte Carlo rollouts
- simulate N futures using deterministic RNG
- choose best expected value

Tier 4 — Adaptive
- learn opponent tendencies (still deterministic if based on recorded history)

Include:
- performance constraints
- caching
- difficulty scaling knobs
- optional “explain move” dev mode

**Acceptance**
- AI is testable + replayable.

---

# Phase 6 — Advanced Features & Innovation Opportunities

Create `docs/features/FEATURES_CATALOG.md` with rows including:
- description
- player value
- learning value
- difficulty
- dependencies
- risks

Include:
- House rules presets
- Challenge scenarios
- Puzzle/coop modes (optional)
- Stats + match history
- Achievements
- Spectator + shareable replays
- Mobile-friendly condensed mode
- Accessibility suite

---

# Phase 7 — Architecture & Engineering Improvements

## 7.1 Refactor strategy (incremental)
Create `docs/eng/REFACTOR_STRATEGY.md`:
- Identify extraction seams:
  - engine core
  - adapters (network/storage)
  - UI selectors/view-model
- Enforce:
  - pure reducer/state machine
  - explicit effect/adapters layer
  - stable event schema

## 7.2 Testing strategy
Create `docs/eng/TEST_STRATEGY.md`:
- unit tests for validators + transitions
- invariants per state
- golden tests using replays
- UI smoke tests
- visual regression tests for key screens

## 7.3 Performance plan
Create `docs/eng/PERFORMANCE_PLAN.md`:
- identify render hotspots
- memoization boundaries
- avoid layout thrash in animations
- log virtualization

## 7.4 Offline-first (optional stretch)
Create `docs/eng/OFFLINE_FIRST.md`:
- service worker/local storage approach
- local match history
- graceful degradation vs multiplayer

---

# Phase 8 — Observability & Developer Experience

## 8.1 Logging + tracing
Create `docs/obs/LOGGING.md`:
- structured logs per engine event
- correlation id per action
- last-N ring buffer export

## 8.2 Deterministic replay debugging
Create `docs/obs/REPLAY_DEBUGGING.md`:
- export replay from match
- load replay in dev
- verify replay in CI

## 8.3 Feature flags & experiments
Create `docs/obs/FEATURE_FLAGS.md`:
- flag storage model
- stable/beta gating
- safe rollout rules

---

# Phase 9 — Security & Integrity (Multiplayer)

Create `docs/security/MULTIPLAYER_SECURITY.md`:
- trust boundaries (clients untrusted)
- server/host validation rules
- hidden info policy (hands)
- anti-cheat basics (rate limits, command validation)
- integrity UX (desync detection, resync states)

---

# Phase X — UI Modernization & Visual System Upgrade

> Objective: elevate interface to polished, modern card game without rewriting engine.

## X.1 Visual Design System
### Design goals
- clean, modern, game-like polish
- high clarity & hierarchy
- tactile card realism with subtle depth
- responsive across desktop + mobile

### Tokens (semantic roles)
Create a reusable token system (CSS vars recommended):
- Color:
  - `color.bg.canvas`, `color.bg.panel`, `color.bg.modal`
  - `color.fg.primary`, `color.fg.muted`, `color.fg.inverse`
  - `color.border.default`, `color.border.focus`
  - `color.action.primary`, `color.action.danger`, `color.action.warning`
  - `color.state.success/info`
  - `color.game.playableGlow`, `color.game.targetValid/Invalid`
  - property colors + patterns/icons for colorblind modes
- Typography:
  - font families: `font.ui`, `font.card`
  - scale: `text.xs..2xl`, line heights, weights
  - tabular numbers for money
- Spacing/layout:
  - `space` scale (4px or 8px rhythm)
  - `radius` scale
- Elevation:
  - `shadow.1..4` + pressed inset
- Motion:
  - durations: 150–250ms primary
  - easings: out/inOut + optional spring
  - reduced-motion mapping

### Theme system
- Provide at least 2 complete themes (e.g., Classic + Neon) using tokens.

## X.2 Card rendering & interaction polish
- Readability at smallest sizes
- Card detail/zoom view on tap/click
- Layered shadows & depth stacking
- Hover lift + subtle tilt (desktop)
- Press compression
- Drag preview + placeholder

Interaction feedback:
- highlight playable cards
- outline/glow valid targets
- invalid action shake + message
- snap placement feedback

## X.3 Layout & spatial organization
Desktop principles:
- at-a-glance: active player, prompt, last action
- ergonomic hand fan/rail
- clear property sets + completion indicators
- distinct bank visuals + totals
- discard pile visible + history view

Responsive rules:
- wide: full table + side panels
- medium: collapsible panels
- narrow/mobile: vertical mode with hand drawer

Adaptive 2–5 players:
- compact “player strips” for non-active players
- expandable detail
- “focus active player” on small screens

## X.4 Turn state & player awareness
- active player highlight ring/panel
- turn banner (“X’s turn — play up to 3”)
- action state banner (“Choose target”, “Select payment”, “Waiting”)
- optional phase progress indicator
- optional spotlight dimming during targeting

## X.5 Motion & animation system
Philosophy:
- fast (150–250ms)
- motion communicates state change
- reduced-motion friendly

Key animations:
- draw deck → hand
- play hand → table
- discard → discard pile
- bank increments
- property set completion celebration
- rent payment transfer visualization

Implementation options:
- Framer Motion with centralized presets
- or CSS/WAAPI + FLIP transitions

## X.6 Micro-interactions & game feel
- button press compression
- card snap feedback (optional sound)
- hover/tap previews
- rent calculation preview before commit
- animated counters for money transfer

## X.7 Accessibility & inclusivity
- colorblind-safe mode (patterns/icons)
- high contrast mode
- UI scale slider
- keyboard navigation for key actions
- screen reader labeling and aria-live for turn/prompts

## X.8 Information clarity & decision support
- contextual tooltips
- expandable card detail
- last action panel
- event log panel with pause/autoscroll
- preview outcomes before committing actions

## X.9 Mobile & cross-device readiness
- touch-friendly hit targets
- drag/drop gestures
- vertical layout mode
- condensed UI mode

## X.10 UI architecture guidance (no engine rewrite)
- Component-based UI kit
- Separate engine state vs UI state
- Animation layer listens to engine events
- Theme abstraction via tokens
- Asset pipeline organization

## X.11 Progressive enhancement roadmap
Quick wins:
- highlight playable cards
- active player indicator
- improved spacing & hierarchy
- hover/tap preview + snap/invalid feedback

Medium impact:
- full token system + component kit
- motion system + core animations
- action state banners
- event log + tooltips
- hand fan/stack physics

High impact / showcase:
- full transitions + set completion effects
- replay animation hooks
- themeable UI presets + UI scale + colorblind patterns

**Phase X acceptance**
- Theme tokens applied across all screens
- Clear turn/prompt guidance
- Core animations implemented with reduced motion support
- Mobile layout usable without precision tapping

---

# Phase 10 — Roadmap & Prioritization

Create `docs/ROADMAP.md` with three buckets:

🥇 High Impact / Low Effort
- playable card highlighting
- active player indicator + prompt banner
- card preview (hover/tap)
- improved spacing/hierarchy
- event log quick improvements
- microcopy fixes (resume/saved games)
- “how to play” CTA
- fix known high-impact bugs (e.g., stats recording)

🥈 Medium Effort / High Value
- token system + component kit migration
- targeting masks + action state banners
- payment UX improvements (owed amount, selection guidance)
- settings redesign
- core animations
- match detail views in stats
- AI Tier 1–2

🥉 Ambitious / Showcase
- deterministic replay viewer + timeline scrubber
- Monte Carlo AI
- spectator mode
- offline-first mode
- modding/house rules presets

Acceptance:
- Roadmap ties directly back to audit findings and feature catalog.

---

# Phase 11 — Implementation Strategy for LLM-Driven Development

## 11.1 Safe incremental refactors
- Add tests before behavior changes.
- Extract behind adapters (new path first, then migrate).
- Avoid rename storms unless necessary.

## 11.2 Documentation accuracy
- Update relevant docs each PR.
- Use ADRs for major decisions.
- Maintain `docs/CHANGELOG_DEV.md`.

## 11.3 Regression avoidance checklist
Per PR:
- unit tests pass
- replay verification (multiple seeds)
- UI smoke test
- no new console errors
- multiplayer handshake validated (if present)

---

# Appendix — Required artifact index
As you proceed, produce these files:
- `docs/BASELINE.md`
- `docs/audit/*`
- `docs/rules/*`
- `docs/replay/*`
- `docs/ux/*`
- `docs/net/*`
- `docs/ai/*`
- `docs/features/*`
- `docs/eng/*`
- `docs/obs/*`
- `docs/security/*`
- `docs/ROADMAP.md`
- `docs/adr/*`

END.

