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

    expect(screen.getByText(/required: resolve this step/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /\$2 card/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm payment/i }));

    expect(mockedApplyAction).toHaveBeenCalledWith(expect.anything(), {
      type: 'pay_request',
      playerId: 'p2',
      cards: ['money_2#b2'],
    });
  });

  it('ignores hand clicks for unplayable cards after 3 plays are used', () => {
    const lockedState: GameState = {
      ...structuredClone(baseState),
      turn: { ...baseState.turn, playsUsed: 3 },
    };
    mockedCreateGame.mockImplementationOnce(() => lockedState);
    mockedGetNextPrompt.mockImplementation(() => ({ playerId: 'p1', text: 'Alpha turn', kind: 'main' }));
    mockedGetLegalActions.mockImplementation(() => [
      {
        label: 'Pass turn',
        action: { type: 'pass_turn', playerId: 'p1' },
      },
    ]);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));
    fireEvent.click(screen.getByRole('button', { name: /\$1 card/i }));

    expect(mockedApplyAction).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: /choose how to play/i })).not.toBeInTheDocument();
  });

  it('shows and uses undo controls for reversible plays in the same turn', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));
    fireEvent.click(screen.getByRole('button', { name: /\$1 card/i }));

    expect(screen.getByRole('button', { name: /undo last play/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /undo last play/i }));
    expect(screen.queryByRole('button', { name: /undo last play/i })).not.toBeInTheDocument();
  });

  it('treats discard as a required prompt and discards selected hand card', () => {
    const discardState: GameState = {
      ...structuredClone(baseState),
      players: [
        {
          ...structuredClone(baseState.players[0]),
          hand: ['money_1#a1', 'money_2#a2', 'money_3#a3', 'money_4#a4', 'money_5#a5', 'pass_go#a6', 'rent_color#a7', 'debt_collector#a8'],
        },
        structuredClone(baseState.players[1]),
      ],
      turn: { ...baseState.turn, playsUsed: 3 },
    };
    mockedCreateGame.mockImplementationOnce(() => discardState);
    mockedGetNextPrompt.mockImplementation(() => ({
      playerId: 'p1',
      text: 'Alpha: discard down to 7 cards to end your turn.',
      kind: 'discard',
    }));
    mockedGetLegalActions.mockImplementation(() => [
      {
        label: 'Discard $1 Money',
        action: { type: 'discard_card', playerId: 'p1', cardId: 'money_1#a1' },
      },
    ]);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));

    expect(screen.getByText(/required: resolve this step/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /\$1 card/i }));

    expect(mockedApplyAction).toHaveBeenCalledWith(expect.anything(), {
      type: 'discard_card',
      playerId: 'p1',
      cardId: 'money_1#a1',
    });
  });
});
