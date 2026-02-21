# Test Strategy

## Pyramid

- Core engine/rule behavior: `src/test/engine.test.ts`
- Multiplayer service lifecycle: `src/test/multiplayer-room-service.test.ts`
- UI integration behaviors: `src/test/app.test.tsx`, targeted screen/component tests
- Persistence/stats compatibility: `src/test/storage.test.ts`, `src/test/stats-dashboard.test.ts`

## New deterministic gates

- Replay hash tests: `src/test/replay.test.ts`
- Determinism tests: `src/test/determinism.test.ts`
- AI contract/determinism tests: `src/test/ai-contract.test.ts`

## Required checks per high-risk change

- `npm run lint`
- `npm run test`
- `npm run build`
- `npm run replay:verify` for engine flow changes

## Manual checks (when needed)

- Multiplayer reconnect/recovery UX path
- Mobile layout and touch hit target checks for game table
- Accessibility pass for pending-flow interactions
