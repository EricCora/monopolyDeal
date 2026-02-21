import { describe, expect, it } from 'vitest';
import { applyAction, createGame, type Action, type GameState } from '../engine';
import { normalizeReplayState, replayStateFingerprint, stableStringify } from '../replay/serialize';

const PLAYERS = [
  { id: 'p1', name: 'Alpha' },
  { id: 'p2', name: 'Beta' },
];

const COMMAND_LOG: Action[] = [
  { type: 'draw_cards', playerId: 'p1' },
  { type: 'pass_turn', playerId: 'p1' },
  { type: 'draw_cards', playerId: 'p2' },
  { type: 'pass_turn', playerId: 'p2' },
];

function runReplay(seed: number, commands: Action[]): GameState {
  let state = createGame({ seed, players: PLAYERS });
  for (const command of commands) {
    const result = applyAction(state, command);
    if (result.error) {
      throw new Error(`Replay command failed (${result.error.code}): ${result.error.message}`);
    }
    state = result.state;
  }
  return state;
}

describe('determinism', () => {
  it('creates identical normalized initial states for the same seed', () => {
    const first = createGame({ seed: 4242, players: PLAYERS });
    const second = createGame({ seed: 4242, players: PLAYERS });

    expect(stableStringify(normalizeReplayState(first))).toBe(stableStringify(normalizeReplayState(second)));
  });

  it('creates different replay fingerprints for different seeds', () => {
    const first = createGame({ seed: 111, players: PLAYERS });
    const second = createGame({ seed: 222, players: PLAYERS });

    expect(replayStateFingerprint(first)).not.toBe(replayStateFingerprint(second));
  });

  it('reaches the same final replay fingerprint for repeated command-log runs', () => {
    const hashes = Array.from({ length: 3 }, () => replayStateFingerprint(runReplay(1337, COMMAND_LOG)));
    expect(new Set(hashes).size).toBe(1);
  });
});
