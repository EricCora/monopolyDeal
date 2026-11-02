import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { chooseHeuristicAction } from '../ai';
import { getCardDefinition } from '../cards/catalog';
import { applyAction, createGame, getLegalActions, getNextPrompt, isGameOver, type GameState } from '../engine';
import { saveActiveGame } from '../persistence/storage';

/** Plays bots against each other until one is about to answer with a Just Say No. */
function gameAboutToSayNo(): GameState {
  for (let seed = 1; seed < 400; seed += 1) {
    let state = createGame({
      seed,
      players: [
        { id: 'p1', name: 'Ann', controller: 'bot', botDifficulty: 'easy' },
        { id: 'p2', name: 'Bea', controller: 'bot', botDifficulty: 'easy' },
      ],
    });
    for (let step = 0; step < 3000 && !isGameOver(state).done; step += 1) {
      const actorId = getNextPrompt(state).playerId;
      const legal = getLegalActions(state, actorId);
      const action = chooseHeuristicAction(state, actorId, legal)?.action ?? legal[0].action;
      const next = applyAction(state, action).state;
      const top = next.discardPile[next.discardPile.length - 1];
      if (top !== state.discardPile[state.discardPile.length - 1] && top && getCardDefinition(top, 'classic').actionKind === 'just_say_no') return state;
      state = next;
    }
  }
  throw new Error('no bot game reached a Just Say No');
}

describe('Just Say No', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stamps the table and names who played it', () => {
    saveActiveGame(gameAboutToSayNo(), 'practice');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    act(() => { vi.advanceTimersByTime(600); });
    expect(document.querySelector('.jsn-stamp')?.textContent).toMatch(/Just Say No!\s*(Ann|Bea)/);
  });
});
