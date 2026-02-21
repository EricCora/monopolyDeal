# Repository Map

This map is intentionally concise and points to canonical implementation files.

## High-level tree (trimmed)

```text
apps/
  server/src/           # Hosted multiplayer API/server-authoritative room service
packages/shared/        # Shared multiplayer protocol/types
scripts/                # Dev and quality automation scripts
src/
  engine/               # Rules engine and legal action generation
  cards/                # Card definitions/rent metadata
  ui/                   # Components, layouts, screens, theme tokens
  app/                  # App-level hooks/orchestration helpers
  network/              # Multiplayer client APIs and transport wrappers
  persistence/          # localStorage read/write compatibility layer
  stats/                # Match stats, retention, post-game analytics
  ai/                   # Heuristic + rollout decision systems
  test/                 # Unit/integration tests
docs/                   # User/agent docs, roadmaps, audits
```

## Source-of-truth modules

- Engine rules and resolution: `src/engine/game.ts`
- Engine types/contracts: `src/engine/types.ts`
- Card catalog and rent model: `src/cards/catalog.ts`
- App orchestration boundary: `src/App.tsx`
- Multiplayer room hook: `src/app/useMultiplayerRoom.ts`
- Multiplayer HTTP/SSE client: `src/network/multiplayerClient.ts`
- Multiplayer server lifecycle: `apps/server/src/gameService.ts`, `apps/server/src/index.ts`
- Persistence compatibility: `src/persistence/storage.ts`
- Stats and post-game model: `src/stats/`

## Tooling overview

- Bundler/dev server: Vite (`vite.config.ts`)
- Language/build: TypeScript (`tsconfig*.json`)
- Lint: ESLint (`eslint.config.js`)
- Tests: Vitest + Testing Library (`src/test/*`)
- Quality gate: `npm run quality` (lint + test + build)

## Canonical cross-links

- Product scope and commands: `README.md`
- Agent architecture guide: `docs/LLM_AGENT_GUIDE.md`
- Refactor guardrails: `docs/REFRACTOR_SAFETY_PLAYBOOK.md`
