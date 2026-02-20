# UX Audit

Scope: active local + multiplayer gameplay flows in `src/ui/screens/GameTableScreen.tsx`, `src/ui/screens/MultiplayerScreen.tsx`, and orchestration in `src/App.tsx`.

## Flow observations

- Onboarding: Home/setup flow is clear, with explicit CTA paths.
- Turn flow: Action rail + prompt banners provide strong phase guidance.
- Pending interactions: Payment/counter/selection banners are visible in-table.
- Error recovery: Multiplayer stale-session recovery and reconnect overlays are explicit.

## Top 10 friction points

1. Forced-deal selection depth can be confusing without visual target constraints.
2. Dense multiplayer controls in top bar can overload new hosts.
3. Room state labels can expose IDs where names are preferred in some contexts.
4. Advanced controls (undo/reset/checkpoints) are powerful but high cognitive load.
5. Settings has many toggles; experimental section helps, but discoverability remains mixed.
6. Stats dashboard complexity can feel heavy on smaller screens.
7. In-table social feed can compete with core action focus on narrow displays.
8. Payment selection lacks explicit “remaining owed” emphasis line in some overpay/shortfall cases.
9. Card interaction confidence depends on subtle visual cues in dense property lanes.
10. Some high-impact actions still require familiarity with Monopoly Deal edge rules.

## Top 10 delight opportunities

1. Expand valid-target highlighting across all selection flows.
2. Add explicit "last action" summary panel near turn guidance.
3. Add compact host-control presets for common multiplayer admin actions.
4. Improve contextual mini-tooltips on legal action buttons.
5. Add stronger “why this is illegal” toast detail for rejected actions.
6. Add optional quick tutorial overlay for pending-flow interaction types.
7. Add keyboard shortcut hints for power users.
8. Add mobile condensed event log mode.
9. Add visual diff cue for changed zones after each action.
10. Add optional card-value/rent mini badges in compact mode.

## Priority accessibility issues

1. Ensure all selection-target highlights are perceivable without color only.
2. Keep aria-live announcements concise and non-spammy during rapid action chains.
3. Validate keyboard traversal for pending property-selection flows end-to-end.
4. Preserve focus management consistency when overlays/dialogs appear.

## Current quick-win status

- In-table pending banners: implemented.
- Payment panel guidance and shortfall messaging: implemented.
- Selection target highlighting: improved in this stage for pending property-selection flows.
