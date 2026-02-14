import type { GameState, LegalAction, PlayerId } from '../engine';
import { chooseHeuristicAction, rankHeuristicActions, type ScoredAction } from './heuristic';
import { chooseMonteCarloAction } from './rollout';

export interface CoachHint {
  title: string;
  summary: string;
  topActionLabel: string;
  alternatives: string[];
}

function toAlternatives(ranked: ScoredAction[]): string[] {
  return ranked
    .slice(1, 3)
    .map((entry) => `${entry.label} (${Math.round(entry.score)})`);
}

export function buildCoachHint(
  state: GameState,
  playerId: PlayerId,
  legalActions: LegalAction[],
  mode: 'easy' | 'hard' = 'easy',
): CoachHint | null {
  if (legalActions.length === 0) return null;

  const ranked = rankHeuristicActions(state, playerId, legalActions);
  const easyPick = chooseHeuristicAction(state, playerId, legalActions);
  const hardPick = chooseMonteCarloAction(state, playerId, legalActions, { simulations: 12, depth: 9 });
  const selected = mode === 'hard' ? hardPick : easyPick;

  if (!selected) return null;

  return {
    title: mode === 'hard' ? 'AI Coach (Hard Search)' : 'AI Coach',
    summary: selected.reason,
    topActionLabel: selected.label,
    alternatives: toAlternatives(ranked),
  };
}
