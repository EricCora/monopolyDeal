import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { applyAction, createGame, getLegalActions, getNextPrompt, type GameState } from '../engine';
import { saveActiveGame, loadActiveGame } from '../persistence/storage';

/** A game two seats in, where the bot is the one being waited on. */
function gameOnBotsTurn(): GameState {
  let state = createGame({
    seed: 7,
    players: [
      { id: 'p1', name: 'Ann', controller: 'human' },
      { id: 'p2', name: 'House Bot', controller: 'bot', botDifficulty: 'easy' },
    ],
  });
  while (getNextPrompt(state).playerId !== 'p2') {
    const legal = getLegalActions(state, getNextPrompt(state).playerId);
    const pass = legal.find((entry) => entry.action.type === 'draw_cards' || entry.action.type === 'pass_turn') ?? legal[0];
    state = applyAction(state, pass.action).state;
  }
  return state;
}

describe('the bot after a pause', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('still takes its turn when the game is paused and resumed while it is thinking', () => {
    const start = gameOnBotsTurn();
    saveActiveGame(start, 'practice');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    // Part way through the bot's thinking time, pause and come straight back.
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.click(screen.getByRole('button', { name: /menu|more/i }));
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.click(screen.getByRole('button', { name: 'Resume game' }));
    act(() => { vi.advanceTimersByTime(1000); });
    // The table saves shortly after each move.
    act(() => { vi.advanceTimersByTime(1000); });
    expect(loadActiveGame()?.gameState.history.length).toBeGreaterThan(start.history.length);
  });
});
