# UX Feature Milestone Release Notes

## Included Milestones

- M0: roadmap + milestone gate checklist docs
- M1: guided action rail turn cues and required-action clarity
- M2: risky action confirmation dialog wired to legal action metadata
- M3: payment assistant auto-select backed by engine helper
- M4: in-game rules reference drawer with set/rent lookup
- M5: stats filters + settings data controls + additive v1 preference/metric fields

## Public Interface Updates

- `LegalAction` now supports optional UX metadata:
- `requiresConfirmation?: boolean`
- `riskLevel?: 'low' | 'medium' | 'high'`
- `previewText?: string`
- Engine exports `getSuggestedPaymentCards(state, playerId, amount)`.

## Persistence Compatibility

- Storage remains `version: 1`.
- Added additive optional UI preference fields:
- `confirmRiskyActions`
- `showRulesDrawerHints`
- Added additive growth metrics counters:
- `payment_auto_selected`
- `rules_drawer_opened`
- Legacy payloads still backfill safe defaults.

## Verification

- Automated checks:
- `npm run test` (66 tests passing)
- `npm run build` (TypeScript + production build passing)

## Manual Smoke Checklist

1. New game flow: reveal, play cards, pass turn.
2. Risky action flow: confirm + cancel both behave correctly.
3. Payment flow: auto-select, submit, shortfall messaging.
4. Rules drawer: open/close via button and Escape.
5. Stats page: apply/clear filters and verify charts/tables update.
6. Settings: clear stats/history and verify empty analytics state.
