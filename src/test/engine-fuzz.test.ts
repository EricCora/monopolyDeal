import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getLegalActions, isGameOver, type GameState } from '../engine';

/** Random legal play with invariants checked after every action. */
function rng(seed: number): () => number {
  let current = seed;
  return () => {
    current = (current * 1664525 + 1013904223) >>> 0;
    return current / 2 ** 32;
  };
}

function allCards(state: GameState): string[] {
  const cards = [...state.drawPile, ...state.discardPile];
  for (const player of state.players) {
    cards.push(...player.hand, ...player.bank);
    for (const entries of Object.values(player.properties)) cards.push(...entries.map((entry) => entry.cardId));
  }
  const pending = state.pending as { kind: string; payload?: { cardId?: string; redistribution?: Array<{ cardId: string }> } } | null;
  if (pending?.kind === 'debt_card' && pending.payload?.cardId) cards.push(pending.payload.cardId);
  if (pending?.payload?.redistribution) cards.push(...pending.payload.redistribution.map((entry) => entry.cardId));
  return cards;
}

function playOut(variant: 'classic' | 'no_mercy', players: number, seed: number): string | null {
  const random = rng(seed);
  let state = createGame({
    seed,
    variant,
    players: Array.from({ length: players }, (_, index) => ({ id: `p${index + 1}`, name: `P${index + 1}` })),
  } as Parameters<typeof createGame>[0]);
  let count = allCards(state).length;
  for (let step = 0; step < 6000; step += 1) {
    if (isGameOver(state).done) return null;
    const options = state.players.flatMap((player) => getLegalActions(state, player.id));
    if (options.length === 0) return `soft-lock at step ${step}: ${JSON.stringify(state.turn)}`;
    const preferred = options.filter((option) => option.action.type !== 'pass_turn' && option.action.type !== 'move_wild');
    const pool = preferred.length > 0 && random() < 0.9 ? preferred : options;
    const choice = pool[Math.floor(random() * pool.length)];
    const result = applyAction(state, choice.action);
    if (result.error) return `legal action rejected: ${choice.label}: ${result.error.message}`;
    state = result.state;
    const cards = allCards(state);
    if (cards.length !== count || new Set(cards).size !== cards.length) return `card count changed after ${choice.label}`;
    count = cards.length;
  }
  return `no finish after 6000 steps`;
}

describe('engine fuzz', () => {
  it.each([
    ['classic', 4],
    ['classic', 5],
    ['no_mercy', 2],
    ['no_mercy', 3],
    ['no_mercy', 5],
  ] as const)('%s with %i players keeps its invariants', (variant, players) => {
    // Seeds include the games that exposed each past failure.
    const seeds = [1120, 36, 5644, 1181, 1987, 4066, ...Array.from({ length: 30 }, (_, index) => index * 31 + players)];
    const failures = seeds
      .map((seed) => [seed, playOut(variant, players, seed)] as const)
      .filter(([, failure]) => failure !== null);
    expect(failures).toEqual([]);
  }, 120_000);
});
