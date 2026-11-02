import { describe, expect, it } from 'vitest';
import { chooseHeuristicAction } from '../ai';
import { applyAction, createGame, getLegalActions, getNextPrompt, isGameOver, type Action } from '../engine';
import { loadActiveReplay, loadReplays, saveActiveReplay, saveReplay } from '../persistence/replays';
import { replayStateFingerprint } from '../replay/serialize';
import { replayPositions } from '../replay/positions';
import { formatClock } from '../ui/table/boardModel';
import { cardBackOptions, newlyUnlocked, tableStyleOptions } from '../ui/unlockables';

const NEW_PLAYER = { wins: 0, actions: 0, quickWins: 0 };

describe('unlockables', () => {
  it('keeps the original three table styles free', () => {
    const free = tableStyleOptions(NEW_PLAYER).filter((option) => option.unlocked).map((option) => option.value);
    expect(free).toEqual(['premium_tabletop', 'classic_green', 'neon_arcade']);
    expect(cardBackOptions(NEW_PLAYER).filter((option) => option.unlocked).map((option) => option.value)).toEqual(['classic_red']);
  });

  it('says what a locked item needs, and unlocks it once earned', () => {
    const locked = tableStyleOptions(NEW_PLAYER).find((option) => option.value === 'midnight_vault');
    expect(locked?.needs).toBe('Win 10 games');
    const earned = tableStyleOptions({ wins: 10, actions: 0, quickWins: 0 }).find((option) => option.value === 'midnight_vault');
    expect(earned?.unlocked).toBe(true);
  });

  it('names only what this game just earned', () => {
    expect(newlyUnlocked(NEW_PLAYER, { wins: 1, actions: 3, quickWins: 0 })).toEqual(['Sunset Lounge table style', 'Ocean Blue card back']);
    expect(newlyUnlocked({ wins: 1, actions: 3, quickWins: 0 }, { wins: 2, actions: 6, quickWins: 0 })).toEqual([]);
  });
});

describe('replays', () => {
  function playGame() {
    const initial = createGame({ seed: 11, players: [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bob' }] });
    let state = initial;
    const actions: Action[] = [];
    for (let step = 0; step < 3000 && !isGameOver(state).done; step += 1) {
      const actorId = getNextPrompt(state).playerId;
      const legal = getLegalActions(state, actorId);
      const action = chooseHeuristicAction(state, actorId, legal)?.action ?? legal[0].action;
      const result = applyAction(state, action);
      state = result.state;
      actions.push(action);
    }
    return { initial, actions, final: state };
  }

  it('rebuilds every position up to the exact end of the game, across a save', () => {
    const { initial, actions, final } = playGame();
    expect(isGameOver(final).done).toBe(true);
    const stored = JSON.parse(JSON.stringify({ initial, actions }));
    const positions = replayPositions(stored);
    expect(positions).toHaveLength(actions.length + 1);
    expect(replayStateFingerprint(positions[positions.length - 1])).toBe(replayStateFingerprint(final));
  });

  it('stops at a move that does not apply, instead of crashing the screen', () => {
    const { initial } = playGame();
    const positions = replayPositions({ initial, actions: [{ type: 'pass_turn', playerId: 'nobody' }] });
    expect(positions).toHaveLength(1);
  });

  it('keeps only the newest', () => {
    const { initial } = playGame();
    for (let index = 0; index < 22; index += 1) saveReplay({ id: `g${index}`, endedAt: index, title: `Game ${index}`, initial, actions: [] });
    const kept = loadReplays().map((entry) => entry.id);
    expect(kept).toHaveLength(20);
    expect(kept[0]).toBe('g21');
    expect(kept).not.toContain('g1');
  });

  it('only resumes a log that belongs to the same game', () => {
    const { initial } = playGame();
    saveActiveReplay({ initial, actions: [] });
    expect(loadActiveReplay(initial)?.actions).toEqual([]);
    expect(loadActiveReplay({ ...initial, createdAt: initial.createdAt + 1 })).toBeNull();
  });
});

describe('formatClock', () => {
  it('reads as minutes, then hours, then days', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(45_000)).toBe('0:45');
    expect(formatClock(125_000)).toBe('2:05');
    expect(formatClock(3 * 3_600_000 + 60_000)).toBe('3h 1m');
    expect(formatClock(50 * 3_600_000)).toBe('2d 2h');
    expect(formatClock(-5)).toBe('0:00');
  });
});
