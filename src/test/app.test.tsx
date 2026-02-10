import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../engine';
import App from '../App';

const { mockedApplyAction, mockedCreateGame, mockedGetNextPrompt, mockedGetLegalActions } = vi.hoisted(() => ({
  mockedApplyAction: vi.fn(),
  mockedCreateGame: vi.fn(),
  mockedGetNextPrompt: vi.fn(),
  mockedGetLegalActions: vi.fn(),
}));

const baseState: GameState = {
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  deckVersion: 'v1',
  players: [
    {
      id: 'p1',
      name: 'Alpha',
      hand: ['money_1#a1'],
      bank: [],
      properties: {
        brown: [],
        light_blue: [],
        pink: [],
        orange: [],
        red: [],
        yellow: [],
        green: [],
        dark_blue: [],
        railroad: [],
        utility: [],
      },
    },
    {
      id: 'p2',
      name: 'Beta',
      hand: ['money_1#b1'],
      bank: ['money_2#b2'],
      properties: {
        brown: [{ cardId: 'brown_1#b3', assignedColor: 'brown' }],
        light_blue: [],
        pink: [],
        orange: [],
        red: [],
        yellow: [],
        green: [],
        dark_blue: [],
        railroad: [],
        utility: [],
      },
    },
  ],
  drawPile: [],
  discardPile: [],
  currentPlayerIndex: 0,
  turn: { phase: 'action', playsUsed: 0, doubleRentMultiplier: 1 },
  pending: null,
  history: [],
  turnCount: 1,
};

vi.mock('../engine', () => {
  const clone = () => structuredClone(baseState);

  return {
    createGame: mockedCreateGame.mockImplementation(() => clone()),
    getNextPrompt: mockedGetNextPrompt.mockImplementation(() => ({ playerId: 'p1', text: 'Alpha turn', kind: 'main' })),
    getSetCompletionCount: vi.fn(() => 0),
    isGameOver: vi.fn(() => ({ done: false, winnerId: undefined })),
    getLegalActions: mockedGetLegalActions.mockImplementation(() => [
      {
        label: 'Draw cards',
        action: { type: 'draw_cards', playerId: 'p1' },
      },
      {
        label: 'Pass turn',
        action: { type: 'pass_turn', playerId: 'p1' },
      },
      {
        label: 'Bank money',
        action: { type: 'play_to_bank', playerId: 'p1', cardId: 'money_1#a1' },
      },
    ]),
    applyAction: mockedApplyAction.mockImplementation((state: GameState, action: unknown) => {
      void action;
      return {
        state: { ...state, updatedAt: state.updatedAt + 1 },
        events: [],
      };
    }),
  };
});

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    mockedApplyAction.mockClear();
    mockedCreateGame.mockReset();
    mockedGetNextPrompt.mockReset();
    mockedGetLegalActions.mockReset();
    mockedCreateGame.mockImplementation(() => structuredClone(baseState));
    mockedGetNextPrompt.mockImplementation(() => ({ playerId: 'p1', text: 'Alpha turn', kind: 'main' }));
    mockedGetLegalActions.mockImplementation(() => [
      {
        label: 'Draw cards',
        action: { type: 'draw_cards', playerId: 'p1' },
      },
      {
        label: 'Pass turn',
        action: { type: 'pass_turn', playerId: 'p1' },
      },
      {
        label: 'Bank money',
        action: { type: 'play_to_bank', playerId: 'p1', cardId: 'money_1#a1' },
      },
    ]);
  });

  it('does not re-prompt reveal for same player after an action', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));
    fireEvent.click(screen.getByRole('button', { name: /\$1 card/i }));

    expect(mockedApplyAction).toHaveBeenCalledWith(expect.anything(), {
      type: 'play_to_bank',
      playerId: 'p1',
      cardId: 'money_1#a1',
    });
    expect(screen.queryByRole('button', { name: /reveal turn/i })).not.toBeInTheDocument();
  });

  it('supports payment by selecting cards and confirming', () => {
    const paymentState: GameState = {
      ...structuredClone(baseState),
      currentPlayerIndex: 0,
      pending: {
        kind: 'payment',
        payload: {
          sourcePlayerId: 'p1',
          targetPlayerId: 'p2',
          amount: 2,
          reason: "It's My Birthday",
          actionCardId: 'its_my_birthday#1',
        },
      },
    };
    mockedCreateGame.mockImplementationOnce(() => paymentState);
    mockedGetNextPrompt.mockImplementation(() => ({ playerId: 'p2', text: 'Beta: choose payment cards totaling $2.', kind: 'payment' }));
    mockedGetLegalActions.mockImplementation(() => []);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));

    expect(screen.getByText(/payment required/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /\$2 card/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm payment/i }));

    expect(mockedApplyAction).toHaveBeenCalledWith(expect.anything(), {
      type: 'pay_request',
      playerId: 'p2',
      cards: ['money_2#b2'],
    });
  });
});
