import { applyAction, type GameState } from '../engine';
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
