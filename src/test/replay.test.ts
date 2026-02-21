import { describe, expect, it } from 'vitest';
import { applyAction, createGame, type Action } from '../engine';
import { replayStateFingerprint } from '../replay/serialize';

const PLAYERS = [
  { id: 'p1', name: 'Alpha' },
  { id: 'p2', name: 'Beta' },
];

const BASE_LOG: Action[] = [
  { type: 'draw_cards', playerId: 'p1' },
  { type: 'pass_turn', playerId: 'p1' },
  { type: 'draw_cards', playerId: 'p2' },
  { type: 'pass_turn', playerId: 'p2' },
];

const EXTENDED_LOG: Action[] = [
  ...BASE_LOG,
  { type: 'draw_cards', playerId: 'p1' },
  { type: 'pass_turn', playerId: 'p1' },
];

function replay(seed: number, commands: Action[]): string {
  let state = createGame({ seed, players: PLAYERS });
  for (const command of commands) {
    const result = applyAction(state, command);
    if (result.error) {
      throw new Error(`Replay failed (${result.error.code}): ${result.error.message}`);
    }
    state = result.state;
  }
  return replayStateFingerprint(state);
}

describe('replay hash verification', () => {
  it('produces identical final hash across repeated runs for the same seed and command log', () => {
    const expected = replay(1337, BASE_LOG);
    expect(replay(1337, BASE_LOG)).toBe(expected);
    expect(replay(1337, BASE_LOG)).toBe(expected);
  });

  it('changes final hash when command log changes', () => {
    const base = replay(1337, BASE_LOG);
    const extended = replay(1337, EXTENDED_LOG);
    expect(extended).not.toBe(base);
  });
});
