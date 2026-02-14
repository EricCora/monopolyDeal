# Monopoly Deal (Local Web App)

A browser-based Monopoly Deal game built with React + TypeScript.

This project focuses on local, pass-and-play gameplay with a rules engine, persistent saves, and match stats.

## Features

- 2 to 4 player local matches with custom player names
- Turn flow enforcement (draw, up to 3 plays, discard to 7, pass)
- Play handling for money, properties, wild cards, and action cards
- Counter flow with `Just Say No` chains
- Payment flow for card effects (including multi-opponent effects like `It's My Birthday`)
- Winner detection at 3 complete property sets
- Undo for reversible plays during the active turn
- Match history and lifetime win stats
- Auto-save + resume via `localStorage`

## Tech Stack

- React 19
- TypeScript
- Vite
- Vitest + Testing Library
- ESLint

## Quick Start

### Prerequisites

- Node.js 20+ (Node.js 22 recommended)
- npm

### Install

```bash
npm install
```

### Run the app

```bash
npm run dev
```

Open the local URL shown by Vite (usually `http://localhost:5173`).

## Scripts

- `npm run dev` - start local dev server
- `npm run build` - type-check and build production assets
- `npm run preview` - preview the production build locally
- `npm run lint` - run ESLint
- `npm run test` - run tests once
- `npm run test:watch` - run tests in watch mode

## Project Structure

```text
src/
  engine/        # Core game rules and action resolution
  cards/         # Card catalog and metadata
  ui/            # UI helpers and React components
  persistence/   # localStorage save/load helpers
  stats/         # Match records and lifetime stat aggregation
  test/          # Engine and UI tests
```

## Agent Documentation

For AI coding agents working on this repository:

- `AGENTS.md` - default operating instructions, invariants, and done criteria
- `docs/LLM_AGENT_GUIDE.md` - deeper architecture map, change playbooks, and test matrix

## Persistence

Game state and stats are stored in browser `localStorage` under versioned keys:

- `monopolyDeal.activeGame.v1`
- `monopolyDeal.matchHistory.v1`
- `monopolyDeal.lifetimeStats.v1`

## Current Scope

- Local multiplayer only (single device, pass-and-play)
- No backend, login, or online matchmaking

## License

No license file is currently defined in this repository.
