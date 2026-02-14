import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../engine';
import App from '../App';
import { createStatsFixture } from './fixtures/statsFixtures';

const { mockedApplyAction, mockedCreateGame, mockedGetNextPrompt, mockedGetLegalActions, mockedIsGameOver } = vi.hoisted(() => ({
  mockedApplyAction: vi.fn(),
  mockedCreateGame: vi.fn(),
  mockedGetNextPrompt: vi.fn(),
  mockedGetLegalActions: vi.fn(),
  mockedIsGameOver: vi.fn(),
}));

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  });
}

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

const MATCH_HISTORY_KEY = 'monopolyDeal.matchHistory.v1';
const LIFETIME_STATS_KEY = 'monopolyDeal.lifetimeStats.v1';

vi.mock('../engine', () => {
  const clone = () => structuredClone(baseState);

  return {
    createGame: mockedCreateGame.mockImplementation(() => clone()),
    getNextPrompt: mockedGetNextPrompt.mockImplementation(() => ({ playerId: 'p1', text: 'Alpha turn', kind: 'main' })),
    getSetCompletionCount: vi.fn(() => 0),
    isGameOver: mockedIsGameOver.mockImplementation((state: GameState) =>
      state.winnerId ? { done: true, winnerId: state.winnerId } : { done: false, winnerId: undefined }),
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
    mockedIsGameOver.mockReset();
    mockMatchMedia(false);
    mockedCreateGame.mockImplementation(() => structuredClone(baseState));
    mockedGetNextPrompt.mockImplementation(() => ({ playerId: 'p1', text: 'Alpha turn', kind: 'main' }));
    mockedIsGameOver.mockImplementation((state: GameState) =>
      state.winnerId ? { done: true, winnerId: state.winnerId } : { done: false, winnerId: undefined });
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

  it('renders pending selection play actions in inline actions and runs target choice', () => {
    mockedGetNextPrompt.mockImplementation(() => ({
      playerId: 'p1',
      text: 'Alpha: resolve the pending card effect.',
      kind: 'selection',
    }));
    mockedGetLegalActions.mockImplementation(() => [
      {
        label: 'Charge Beta rent for Green',
        action: {
          type: 'play_action',
          playerId: 'p1',
          cardId: 'rent_green_dark_blue#r1',
          targetPlayerId: 'p2',
          color: 'green',
        },
        targetPlayerId: 'p2',
        requestedAmount: 8,
        collectibleCap: 3,
        requiresPropertyTransfer: true,
      },
    ]);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));

    fireEvent.click(screen.getByRole('button', { name: /charge beta rent for green/i }));

    expect(mockedApplyAction).toHaveBeenCalledWith(expect.anything(), {
      type: 'play_action',
      playerId: 'p1',
      cardId: 'rent_green_dark_blue#r1',
      targetPlayerId: 'p2',
      color: 'green',
    });
  });

  it('renders analytics sections on the stats page from deterministic fixture data', async () => {
    const fixture = createStatsFixture('medium');
    localStorage.setItem(MATCH_HISTORY_KEY, JSON.stringify(fixture.history));
    localStorage.setItem(LIFETIME_STATS_KEY, JSON.stringify(fixture.lifetime));

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /stats & history/i }));

    expect(await screen.findByRole('heading', { name: /stats & history/i })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /wins by player/i })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /lifetime players/i })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /match history/i })).toBeInTheDocument();
    expect(screen.getByText(/total matches/i)).toBeInTheDocument();
  });

  it('supports sorting lifetime and match tables on the stats page', async () => {
    const fixture = createStatsFixture('medium');
    localStorage.setItem(MATCH_HISTORY_KEY, JSON.stringify(fixture.history));
    localStorage.setItem(LIFETIME_STATS_KEY, JSON.stringify(fixture.lifetime));

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /stats & history/i }));

    const lifetimeHeading = await screen.findByRole('heading', { name: /lifetime players/i });
    const lifetimeSection = lifetimeHeading.closest('section');
    expect(lifetimeSection).not.toBeNull();
    const winsHeader = within(lifetimeSection as HTMLElement).getByRole('button', { name: /^wins/i });
    const lifetimeRows = within(lifetimeSection as HTMLElement).getAllByRole('row');
    expect(within(lifetimeRows[1]).getByText('Alpha')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(winsHeader);
    });
    const ascLifetimeRows = within(lifetimeSection as HTMLElement).getAllByRole('row');
    expect(within(ascLifetimeRows[1]).getByText('Gamma')).toBeInTheDocument();

    const matchHeading = await screen.findByRole('heading', { name: /match history/i });
    const matchSection = matchHeading.closest('section');
    expect(matchSection).not.toBeNull();
    const endedAtHeader = within(matchSection as HTMLElement).getByRole('button', { name: /^ended at/i });
    const matchRows = within(matchSection as HTMLElement).getAllByRole('row');
    expect(within(matchRows[1]).getByText('24')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(endedAtHeader);
    });
    const ascMatchRows = within(matchSection as HTMLElement).getAllByRole('row');
    const firstMatchCells = ascMatchRows[1].querySelectorAll('td');
    expect(firstMatchCells[3]?.textContent).toBe('16');
  });

  it('navigates to a dedicated game-over screen and focuses the victory title', async () => {
    mockedApplyAction.mockImplementationOnce((state: GameState) => ({
      state: {
        ...state,
        winnerId: 'p1',
        turn: { ...state.turn, phase: 'finished' },
        updatedAt: state.updatedAt + 10_000,
        history: [{ timestamp: 100, type: 'action', message: 'Alpha closed the match with a final set.' }],
      },
      events: [],
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));
    fireEvent.click(screen.getByRole('button', { name: /\$1 card/i }));

    const victoryHeading = await screen.findByRole('heading', { name: /alpha wins!/i });
    expect(victoryHeading).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /game table/i })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(document.activeElement).toBe(victoryHeading);
    });
  });

  it('starts a rematch with the same players from the post-game screen', async () => {
    mockedApplyAction.mockImplementationOnce((state: GameState) => ({
      state: {
        ...state,
        winnerId: 'p1',
        turn: { ...state.turn, phase: 'finished' },
        updatedAt: state.updatedAt + 4_000,
        history: [{ timestamp: 100, type: 'action', message: 'Alpha finished the game.' }],
      },
      events: [],
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));
    fireEvent.click(screen.getByRole('button', { name: /\$1 card/i }));

    await screen.findByRole('button', { name: /play rematch/i });
    fireEvent.click(screen.getByRole('button', { name: /play rematch/i }));

    expect(mockedCreateGame).toHaveBeenLastCalledWith({
      players: [
        { id: 'p1', name: 'Alpha' },
        { id: 'p2', name: 'Beta' },
      ],
      deckVersion: 'v1',
    });
    expect(screen.getByRole('heading', { name: /game table/i })).toBeInTheDocument();
  });

  it('routes to stats from the post-game screen', async () => {
    mockedApplyAction.mockImplementationOnce((state: GameState) => ({
      state: {
        ...state,
        winnerId: 'p1',
        turn: { ...state.turn, phase: 'finished' },
        updatedAt: state.updatedAt + 5_000,
        history: [{ timestamp: 100, type: 'action', message: 'Alpha won the game.' }],
      },
      events: [],
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));
    fireEvent.click(screen.getByRole('button', { name: /\$1 card/i }));

    await screen.findByRole('button', { name: /view stats/i });
    fireEvent.click(screen.getByRole('button', { name: /view stats/i }));

    expect(screen.getByRole('heading', { name: /stats & history/i })).toBeInTheDocument();
  });

  it('disables celebration visuals when reduced motion is preferred', async () => {
    mockMatchMedia(true);
    mockedApplyAction.mockImplementationOnce((state: GameState) => ({
      state: {
        ...state,
        winnerId: 'p1',
        turn: { ...state.turn, phase: 'finished' },
        updatedAt: state.updatedAt + 6_000,
        history: [{ timestamp: 100, type: 'action', message: 'Alpha won quickly.' }],
      },
      events: [],
    }));

    const { container } = render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));
    fireEvent.click(screen.getByRole('button', { name: /\$1 card/i }));

    await screen.findByRole('heading', { name: /alpha wins!/i });
    expect(container.querySelector('.confetti-dot')).toBeNull();
    expect(screen.getByText(/system reduced-motion preference is enabled/i)).toBeInTheDocument();
  });
});
