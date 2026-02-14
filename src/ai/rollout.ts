import {
  applyAction,
  getLegalActions,
  getNextPrompt,
  getSetCompletionCount,
  isGameOver,
  type GameState,
  type LegalAction,
  type PlayerId,
} from '../engine';
import { chooseHeuristicAction, rankHeuristicActions, type ScoredAction } from './heuristic';

interface RolloutOptions {
  simulations?: number;
  depth?: number;
  seed?: number;
}

function makeRand(seed: number): () => number {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function evaluateState(state: GameState, playerId: PlayerId): number {
  const me = state.players.find((player) => player.id === playerId);
  if (!me) return -999;

  const mySets = getSetCompletionCount(me);
  const myBank = me.bank.length;
  const myHand = me.hand.length;
  const myScore = mySets * 220 + myBank * 16 + myHand * 6;

  let bestOpponent = -Infinity;
  for (const player of state.players) {
    if (player.id === playerId) continue;
    const score = getSetCompletionCount(player) * 200 + player.bank.length * 14 + player.hand.length * 5;
    if (score > bestOpponent) bestOpponent = score;
  }

  return myScore - (Number.isFinite(bestOpponent) ? bestOpponent : 0);
}

function chooseRolloutAction(state: GameState, actorId: PlayerId, legalActions: LegalAction[], rand: () => number): LegalAction {
  if (legalActions.length === 1) return legalActions[0];

  const ranked = rankHeuristicActions(state, actorId, legalActions);
  const top = ranked.slice(0, Math.min(3, ranked.length));
  if (top.length === 0) return legalActions[0];

  const roll = rand();
  if (roll < 0.62) {
    const selected = top[0];
    return legalActions.find((item) => JSON.stringify(item.action) === JSON.stringify(selected.action)) ?? legalActions[0];
  }
  if (roll < 0.86) {
    const selected = top[Math.min(1, top.length - 1)];
    return legalActions.find((item) => JSON.stringify(item.action) === JSON.stringify(selected.action)) ?? legalActions[0];
  }
  const selected = top[Math.min(2, top.length - 1)];
  return legalActions.find((item) => JSON.stringify(item.action) === JSON.stringify(selected.action)) ?? legalActions[0];
}

function rolloutSimulation(startState: GameState, rootPlayerId: PlayerId, depth: number, rand: () => number): number {
  let state = structuredClone(startState);

  for (let step = 0; step < depth; step += 1) {
    const status = isGameOver(state);
    if (status.done) {
      if (status.winnerId === rootPlayerId) return 1200 - step * 10;
      return -1200 + step * 10;
    }

    const prompt = getNextPrompt(state);
    const legal = getLegalActions(state, prompt.playerId);
    if (legal.length === 0) break;

    const selected = chooseRolloutAction(state, prompt.playerId, legal, rand);
    const result = applyAction(state, selected.action);
    if (result.error) break;
    state = result.state;
  }

  return evaluateState(state, rootPlayerId);
}

export interface RolloutDecision extends ScoredAction {
  simulationScore: number;
  simulations: number;
}

export function chooseMonteCarloAction(
  state: GameState,
  actorId: PlayerId,
  legalActions: LegalAction[],
  options: RolloutOptions = {},
): RolloutDecision | null {
  if (legalActions.length === 0) return null;

  const simulations = options.simulations ?? 16;
  const depth = options.depth ?? 10;
  const rand = makeRand(options.seed ?? state.turnCount + state.history.length + 17);

  let best: RolloutDecision | null = null;

  for (const legal of legalActions) {
    const first = applyAction(state, legal.action);
    if (first.error) continue;

    const immediate = chooseHeuristicAction(state, actorId, [legal]);
    let total = immediate?.score ?? 0;

    for (let i = 0; i < simulations; i += 1) {
      total += rolloutSimulation(first.state, actorId, depth, rand);
    }

    const average = total / (simulations + 1);
    const candidate: RolloutDecision = {
      action: legal.action,
      label: legal.label,
      score: average,
      reason: `${simulations} rollout simulations estimated this as strongest expected value.`,
      simulationScore: average,
      simulations,
    };

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  if (best) return best;

  const fallback = chooseHeuristicAction(state, actorId, legalActions);
  if (!fallback) return null;
  return {
    ...fallback,
    simulationScore: fallback.score,
    simulations: 0,
  };
}
