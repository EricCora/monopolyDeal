import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { chooseHeuristicAction } from '../ai';
import { applyAction, createGame, getLegalActions, getNextPrompt, isGameOver, type Action } from '../engine';
import { loadReplays, saveActiveReplay, saveReplay, type GameReplayLog } from '../persistence/replays';
import { loadActiveGame, loadMatchHistory, saveActiveGame, saveMatchHistory } from '../persistence/storage';
import { replayPositions, retryTurnStart } from '../replay/positions';
import { buildMatchRecord } from '../stats';

const players = [{ id: 'you', name: 'You' }, { id: 'bot', name: 'House Bot', controller: 'bot' as const }];

function completedReplay(): GameReplayLog {
  const initial = createGame({ seed: 21, players });
  const actions: Action[] = [];
  let state = initial;
  while (!isGameOver(state).done) {
    const actor = getNextPrompt(state).playerId;
    const legal = getLegalActions(state, actor);
    const action = chooseHeuristicAction(state, actor, legal)?.action ?? legal[0].action;
    state = applyAction(state, action).state;
    actions.push(action);
  }
  return { initial, actions };
}

function quickWinReplay(): GameReplayLog {
  const initial = createGame({ seed: 815, players, ruleset: { winCompleteSets: 1 } });
  const [brownA, brownB] = initial.players[0].hand.filter((id) => id.startsWith('brown_1#'));
  return {
    initial,
    actions: [
      { type: 'draw_cards', playerId: 'you' },
      { type: 'play_property', playerId: 'you', cardId: brownA, color: 'brown' },
      { type: 'play_property', playerId: 'you', cardId: brownB, color: 'brown' },
    ],
  };
}

describe('retry a replayed turn', () => {
  beforeEach(() => localStorage.clear());

  it('finds the draw step of a later human turn and refuses invalid positions', () => {
    const log = completedReplay();
    const positions = replayPositions(log);
    const draw = positions.findIndex((state) => state.turnCount > 1
      && state.turn.phase === 'draw' && state.players[state.currentPlayerIndex].id === 'you');
    expect(draw).toBeGreaterThan(0);
    expect(retryTurnStart(positions, log.actions.length, draw + 1)).toBe(positions[draw]);
    const botTurn = positions.findIndex((state) => state.players[state.currentPlayerIndex].id === 'bot');
    expect(retryTurnStart(positions, log.actions.length, botTurn)).toBeNull();
    expect(retryTurnStart(positions, log.actions.length, positions.length - 1)).toBeNull();
    expect(retryTurnStart(positions.slice(0, -1), log.actions.length, 0)).toBeNull();
    expect(retryTurnStart(positions.slice(0, 2), 1, 0)).toBeNull();
    const passAndPlay = { ...positions[0], players: positions[0].players.map((player) => ({ ...player, controller: 'human' as const })) };
    expect(retryTurnStart([passAndPlay, ...positions.slice(1)], log.actions.length, 0)).toBeNull();
  });

  it('keeps an online replay read-only even when it has one human seat', async () => {
    const log = quickWinReplay();
    const final = replayPositions(log).at(-1)!;
    const record = buildMatchRecord(final, { mode: 'live_online', surface: 'multiplayer' });
    saveMatchHistory([record]);
    saveReplay({ ...log, id: record.id, endedAt: record.endedAt, title: 'You won' });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Stats & History' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }, { timeout: 5000 }));
    fireEvent.click(screen.getByRole('button', { name: 'Watch Replay' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next move' }));
    expect(screen.getByText('Move 1 of 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry This Turn' })).toBeNull();
  });

  it('plays a different move, finishes without recording, and returns to the original replay', async () => {
    const log = quickWinReplay();
    const positions = replayPositions(log);
    expect(positions).toHaveLength(4);
    const record = buildMatchRecord(positions[3], { mode: 'practice', surface: 'local' });
    saveMatchHistory([record]);
    saveReplay({ ...log, id: record.id, endedAt: record.endedAt, title: 'You won' });
    const activeGame = createGame({ seed: 42, players });
    saveActiveGame(activeGame, 'practice');
    saveActiveReplay({ initial: activeGame, actions: [] });
    const originalSave = loadActiveGame();
    const originalReplay = loadReplays();
    const originalHistory = loadMatchHistory();

    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Stats & History' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }, { timeout: 5000 }));
    fireEvent.click(screen.getByRole('button', { name: 'Watch Replay' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next move' }));
    expect(screen.getByText('Move 1 of 3')).toBeInTheDocument();
    const beforeRetry = { ...localStorage };
    fireEvent.click(screen.getByRole('button', { name: 'Retry This Turn' }));
    fireEvent.click(screen.getByRole('button', { name: 'Draw cards' }));

    const card = (id: string) => {
      const button = container.querySelector(`[data-flip-zone="hand"][data-flip-id="${id}"] button`);
      expect(button).not.toBeNull();
      return button!;
    };
    const hand = log.initial.players[0].hand;
    const [brownA, brownB] = hand.filter((id) => id.startsWith('brown_1#'));
    const money = hand.find((id) => id.startsWith('money_'))!;
    fireEvent.click(card(money));
    expect(container.querySelector(`[data-flip-zone="hand"][data-flip-id="${money}"]`)).toBeNull();
    fireEvent.click(card(brownA));
    fireEvent.click(card(brownB));
    const result = screen.getByRole('dialog', { name: 'Retry complete' });
    expect(within(result).getByText('You win!')).toBeInTheDocument();
    expect(loadActiveGame()).toEqual(originalSave);
    expect(loadReplays()).toEqual(originalReplay);
    expect(loadMatchHistory()).toEqual(originalHistory);
    expect({ ...localStorage }).toEqual(beforeRetry);

    fireEvent.click(within(result).getByRole('button', { name: 'Back to Replay' }));
    expect(screen.getByText('Move 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next move' }));
    expect(screen.getByText('Move 2 of 3')).toBeInTheDocument();
    expect(container.querySelector(`[data-flip-zone="hand"][data-flip-id="${money}"]`)).not.toBeNull();
  });
});
