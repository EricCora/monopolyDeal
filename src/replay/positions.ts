import { applyAction, isGameOver, type GameState } from '../engine';
import type { GameReplayLog } from '../persistence/replays';

/** Rebuilds each position of a finished game. A move that won't apply ends the replay there. */
export function replayPositions(log: GameReplayLog): GameState[] {
  const positions = [log.initial];
  let state = log.initial;
  for (const action of log.actions) {
    const result = applyAction(state, action);
    if (result.error) break;
    state = result.state;
    positions.push(state);
  }
  return positions;
}

/** The recorded draw step for the sole human's turn in a complete local replay. */
export function retryTurnStart(positions: GameState[], actionCount: number, index: number): GameState | null {
  const current = positions[index];
  const last = positions.at(-1);
  if (!current || !last || positions.length !== actionCount + 1 || !isGameOver(last).done || isGameOver(current).done) return null;
  const humans = current.players.filter((player) => player.controller !== 'bot');
  if (humans.length !== 1 || current.players[current.currentPlayerIndex]?.id !== humans[0].id) return null;
  for (let step = index; step >= 0 && positions[step].turnCount === current.turnCount; step -= 1) {
    const state = positions[step];
    if (state.turn.phase === 'draw' && !state.pending) return state;
  }
  return null;
}
