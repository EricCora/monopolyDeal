import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../engine';
import { createDevStatsFixture } from '../stats';
import App from '../App';
import { createStatsFixture } from './fixtures/statsFixtures';

const { mockedApplyAction, mockedCreateGame, mockedGetNextPrompt, mockedGetLegalActions, mockedIsGameOver, mockedGetSuggestedPaymentCards } = vi.hoisted(() => ({
  mockedApplyAction: vi.fn(),
  mockedCreateGame: vi.fn(),
  mockedGetNextPrompt: vi.fn(),
  mockedGetLegalActions: vi.fn(),
  mockedIsGameOver: vi.fn(),
  mockedGetSuggestedPaymentCards: vi.fn(),
}));

const { mockedGeneratePostGameSharePng, mockedPostGameShareFilename } = vi.hoisted(() => ({
  mockedGeneratePostGameSharePng: vi.fn(),
  mockedPostGameShareFilename: vi.fn(),
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

const ACTIVE_GAME_KEY = 'monopolyDeal.activeGame.v1';
const MATCH_HISTORY_KEY = 'monopolyDeal.matchHistory.v1';
const LIFETIME_STATS_KEY = 'monopolyDeal.lifetimeStats.v1';
const GROWTH_METRICS_KEY = 'monopolyDeal.growthMetrics.v1';
const UI_PREFERENCES_KEY = 'monopolyDeal.uiPreferences.v1';
const SAVED_GAMES_KEY = 'monopolyDeal.savedGames.v1';

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
    getSuggestedPaymentCards: mockedGetSuggestedPaymentCards.mockImplementation(() => []),
    applyAction: mockedApplyAction.mockImplementation((state: GameState, action: unknown) => {
      void action;
      return {
        state: { ...state, updatedAt: state.updatedAt + 1 },
        events: [],
      };
    }),
  };
});

vi.mock('../ui/share/postGameShare', () => ({
  generatePostGameSharePng: mockedGeneratePostGameSharePng,
  postGameShareFilename: mockedPostGameShareFilename,
}));

describe('App', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    localStorage.clear();
    mockedApplyAction.mockClear();
    mockedCreateGame.mockReset();
    mockedGetNextPrompt.mockReset();
    mockedGetLegalActions.mockReset();
    mockedIsGameOver.mockReset();
    mockedGetSuggestedPaymentCards.mockReset();
    mockedGeneratePostGameSharePng.mockReset();
    mockedPostGameShareFilename.mockReset();
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
    mockedGetSuggestedPaymentCards.mockImplementation(() => []);
    mockedGeneratePostGameSharePng.mockResolvedValue(new Blob(['share'], { type: 'image/png' }));
    mockedPostGameShareFilename.mockReturnValue('share.png');
    Object.defineProperty(window, 'ClipboardItem', {
      configurable: true,
      writable: true,
      value: class ClipboardItemMock {
        readonly items: Record<string, Blob>;
        constructor(items: Record<string, Blob>) {
          this.items = items;
        }
      },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: {
        write: vi.fn().mockResolvedValue(undefined),
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      writable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(window, 'prompt', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'Renamed Slot'),
    });
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

  it('supports auto-selecting suggested payment cards', () => {
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
    mockedGetSuggestedPaymentCards.mockImplementation(() => ['money_2#b2']);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));
    fireEvent.click(screen.getByRole('button', { name: /auto-select payment/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm payment/i }));

    expect(mockedGetSuggestedPaymentCards).toHaveBeenCalledWith(expect.anything(), 'p2', 2);
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

  it('keeps undo controls visible during discard-required prompt after a reversible play', () => {
    mockedGetNextPrompt.mockImplementation((state: GameState) => (
      state.updatedAt > 1
        ? { playerId: 'p1', text: 'Alpha: discard down to 7 cards to end your turn.', kind: 'discard' }
        : { playerId: 'p1', text: 'Alpha turn', kind: 'main' }
    ));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));
    fireEvent.click(screen.getByRole('button', { name: /\$1 card/i }));

    expect(screen.getByRole('button', { name: /undo last play/i })).toBeInTheDocument();
  });

  it('allows undoing the initial draw action', () => {
    mockedGetNextPrompt.mockImplementation((state: GameState) => (
      state.updatedAt > 1
        ? { playerId: 'p1', text: 'Alpha turn', kind: 'main' }
        : { playerId: 'p1', text: 'Alpha: draw 2 cards.', kind: 'draw' }
    ));
    mockedGetLegalActions.mockImplementation((state: GameState) => {
      if (state.updatedAt > 1) {
        return [{ label: 'Pass turn', action: { type: 'pass_turn', playerId: 'p1' } }];
      }
      return [{ label: 'Draw cards', action: { type: 'draw_cards', playerId: 'p1' } }];
    });

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));
    fireEvent.click(screen.getByRole('button', { name: /draw cards/i }));

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

    expect(screen.getByText(/end turn \(discard 1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/discard 1 card to end turn/i)).toBeInTheDocument();
    expect(screen.getByText(/required: resolve this step/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /\$1 card/i }));

    expect(mockedApplyAction).toHaveBeenCalledWith(expect.anything(), {
      type: 'discard_card',
      playerId: 'p1',
      cardId: 'money_1#a1',
    });
  });

  it('shows draw-step guidance and play budget cues in the action rail', () => {
    mockedGetNextPrompt.mockImplementation(() => ({ playerId: 'p1', text: 'Alpha: draw 2 cards.', kind: 'draw' }));
    mockedGetLegalActions.mockImplementation(() => [
      {
        label: 'Draw cards',
        action: { type: 'draw_cards', playerId: 'p1' },
      },
    ]);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));

    expect(screen.getByLabelText(/turn phase progress/i)).toHaveTextContent(/1\.\s*Draw/i);
    expect(screen.getByText(/draw to start the turn/i)).toBeInTheDocument();
    expect(screen.getByText(/play up to 3 cards \(0\/3\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/player hand/i)).toHaveAttribute('data-layout', 'rail');
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

  it('allows sly deal selection by clicking target property card', () => {
    const slyState: GameState = {
      ...structuredClone(baseState),
      pending: {
        kind: 'sly_deal',
        payload: {
          sourcePlayerId: 'p1',
          targetPlayerId: 'p2',
          actionCardId: 'sly_deal#s1',
        },
      },
    };
    mockedCreateGame.mockImplementationOnce(() => slyState);
    mockedGetNextPrompt.mockImplementation(() => ({
      playerId: 'p1',
      text: 'Alpha: choose a card to steal.',
      kind: 'selection',
    }));
    mockedGetLegalActions.mockImplementation(() => [
      {
        label: 'Take Brown from Beta to Brown',
        action: {
          type: 'sly_deal_pick',
          playerId: 'p1',
          cardId: 'brown_1#b3',
          sourceColor: 'brown',
          destinationColor: 'brown',
        },
      },
    ]);

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));

    fireEvent.click(screen.getByRole('button', { name: /brown card/i }));
    expect(mockedApplyAction).toHaveBeenCalledWith(expect.anything(), {
      type: 'sly_deal_pick',
      playerId: 'p1',
      cardId: 'brown_1#b3',
      sourceColor: 'brown',
      destinationColor: 'brown',
    });
  });

  it('supports forced deal two-step selection by clicking own then opponent property cards', () => {
    const forcedState: GameState = {
      ...structuredClone(baseState),
      players: [
        {
          ...structuredClone(baseState.players[0]),
          properties: {
            brown: [{ cardId: 'brown_1#a9', assignedColor: 'brown' }],
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
          ...structuredClone(baseState.players[1]),
          properties: {
            brown: [],
            light_blue: [],
            pink: [],
            orange: [],
            red: [],
            yellow: [],
            green: [],
            dark_blue: [],
            railroad: [{ cardId: 'railroad_1#b9', assignedColor: 'railroad' }],
            utility: [],
          },
        },
      ],
      pending: {
        kind: 'forced_deal',
        payload: {
          sourcePlayerId: 'p1',
          targetPlayerId: 'p2',
          actionCardId: 'forced_deal#f1',
        },
      },
    };
    mockedCreateGame.mockImplementationOnce(() => forcedState);
    mockedGetNextPrompt.mockImplementation(() => ({
      playerId: 'p1',
      text: 'Alpha: choose cards to swap.',
      kind: 'selection',
    }));
    mockedGetLegalActions.mockImplementation(() => [
      {
        label: 'Swap Brown for Railroad',
        action: {
          type: 'forced_deal_pick',
          playerId: 'p1',
          giveCardId: 'brown_1#a9',
          giveColor: 'brown',
          takeCardId: 'railroad_1#b9',
          takeColor: 'railroad',
          destinationColor: 'railroad',
        },
      },
    ]);

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));

    const alphaPanel = screen.getByRole('heading', { name: 'Alpha' }).closest('article');
    const betaPanel = screen.getByRole('heading', { name: 'Beta' }).closest('article');
    expect(alphaPanel).not.toBeNull();
    expect(betaPanel).not.toBeNull();

    fireEvent.click(within(alphaPanel as HTMLElement).getByRole('button', { name: /brown card/i }));
    fireEvent.click(within(betaPanel as HTMLElement).getByRole('button', { name: /railroad card/i }));

    expect(mockedApplyAction).toHaveBeenCalledWith(expect.anything(), {
      type: 'forced_deal_pick',
      playerId: 'p1',
      giveCardId: 'brown_1#a9',
      giveColor: 'brown',
      takeCardId: 'railroad_1#b9',
      takeColor: 'railroad',
      destinationColor: 'railroad',
    });
  });

  it('shows risky action confirmation dialog and cancels safely', () => {
    mockedGetNextPrompt.mockImplementation(() => ({
      playerId: 'p1',
      text: 'Alpha: choose target for Deal Breaker.',
      kind: 'selection',
    }));
    mockedGetLegalActions.mockImplementation(() => [
      {
        label: 'Play Deal Breaker on Beta',
        action: {
          type: 'play_action',
          playerId: 'p1',
          cardId: 'deal_breaker#d1',
          targetPlayerId: 'p2',
        },
        requiresConfirmation: true,
        riskLevel: 'high',
        previewText: 'This can steal an entire complete set.',
      },
    ]);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));
    fireEvent.click(screen.getByRole('button', { name: /play deal breaker on beta/i }));

    expect(screen.getByRole('dialog', { name: /confirm risky action/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(mockedApplyAction).not.toHaveBeenCalled();
  });

  it('confirms risky action and dispatches exactly once', () => {
    mockedGetNextPrompt.mockImplementation(() => ({
      playerId: 'p1',
      text: 'Alpha: choose target for Deal Breaker.',
      kind: 'selection',
    }));
    mockedGetLegalActions.mockImplementation(() => [
      {
        label: 'Play Deal Breaker on Beta',
        action: {
          type: 'play_action',
          playerId: 'p1',
          cardId: 'deal_breaker#d1',
          targetPlayerId: 'p2',
        },
        requiresConfirmation: true,
        riskLevel: 'high',
        previewText: 'This can steal an entire complete set.',
      },
    ]);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));
    fireEvent.click(screen.getByRole('button', { name: /play deal breaker on beta/i }));
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    expect(mockedApplyAction).toHaveBeenCalledTimes(1);
    expect(mockedApplyAction).toHaveBeenCalledWith(expect.anything(), {
      type: 'play_action',
      playerId: 'p1',
      cardId: 'deal_breaker#d1',
      targetPlayerId: 'p2',
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

  it('seeds stats and history when dev mode is enabled and local data is empty', async () => {
    const fixture = createDevStatsFixture('medium');

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^settings$/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /dev mode/i }));

    expect(JSON.parse(localStorage.getItem(MATCH_HISTORY_KEY) ?? '[]')).toEqual(fixture.history);
    expect(JSON.parse(localStorage.getItem(LIFETIME_STATS_KEY) ?? '{}')).toEqual(fixture.lifetime);
    expect(screen.getByText(/seeded medium sample stats and match history/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    fireEvent.click(screen.getByRole('button', { name: /stats & history/i }));

    expect(await screen.findByRole('heading', { name: /stats & history/i })).toBeInTheDocument();
    expect(screen.getByText(/total matches/i)).toBeInTheDocument();
  });

  it('does not overwrite existing stats/history when enabling dev mode', () => {
    const existingHistory = [
      {
        id: 'existing-1',
        startedAt: 1,
        endedAt: 11,
        players: ['Existing'],
        winnerId: 'p1',
        winnerName: 'Existing',
        turnCount: 5,
        durationSec: 10,
        actionsByType: { action: 3 },
      },
    ];
    const existingLifetime = {
      version: 1,
      players: {
        Existing: {
          name: 'Existing',
          gamesPlayed: 1,
          wins: 1,
          totalTurns: 5,
          totalDurationSec: 10,
          actionsByType: { action: 3 },
        },
      },
    };
    localStorage.setItem(MATCH_HISTORY_KEY, JSON.stringify(existingHistory));
    localStorage.setItem(LIFETIME_STATS_KEY, JSON.stringify(existingLifetime));

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^settings$/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /dev mode/i }));

    expect(JSON.parse(localStorage.getItem(MATCH_HISTORY_KEY) ?? '[]')).toEqual(existingHistory);
    expect(JSON.parse(localStorage.getItem(LIFETIME_STATS_KEY) ?? '{}')).toEqual(existingLifetime);
    expect(screen.getByText(/skipped auto-seed because match history already contains data/i)).toBeInTheDocument();
  });

  it('reseeds stats/history from settings when requested', () => {
    const fixture = createDevStatsFixture('medium');
    localStorage.setItem(
      MATCH_HISTORY_KEY,
      JSON.stringify([
        {
          id: 'old-1',
          startedAt: 5,
          endedAt: 6,
          players: ['Old'],
          turnCount: 1,
          durationSec: 1,
          actionsByType: {},
        },
      ]),
    );
    localStorage.setItem(
      LIFETIME_STATS_KEY,
      JSON.stringify({
        version: 1,
        players: {},
      }),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^settings$/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /dev mode/i }));
    fireEvent.click(screen.getByRole('button', { name: /reseed stats & history/i }));

    expect(JSON.parse(localStorage.getItem(MATCH_HISTORY_KEY) ?? '[]')).toEqual(fixture.history);
    expect(JSON.parse(localStorage.getItem(LIFETIME_STATS_KEY) ?? '{}')).toEqual(fixture.lifetime);
    expect(screen.getByText(/replaced stats and match history with medium sample data/i)).toBeInTheDocument();
  });

  it('clears local stats and history from settings data controls', () => {
    localStorage.setItem(MATCH_HISTORY_KEY, JSON.stringify(createStatsFixture('medium').history));
    localStorage.setItem(LIFETIME_STATS_KEY, JSON.stringify(createStatsFixture('medium').lifetime));
    localStorage.setItem(
      GROWTH_METRICS_KEY,
      JSON.stringify({
        version: 1,
        events: {
          share_image_clicked: 1,
          share_image_success: 1,
          payment_auto_selected: 1,
          rules_drawer_opened: 1,
          game_started: 1,
          game_completed: 1,
          rematch_started: 1,
          lan_room_hosted: 1,
          lan_room_joined: 1,
          coach_hint_viewed: 1,
          multiplayer_host_started: 0,
          multiplayer_join_success: 0,
          multiplayer_join_failed: 0,
          multiplayer_invite_copied: 0,
          multiplayer_deep_link_opened: 0,
          multiplayer_reconnect_success: 0,
          multiplayer_reconnect_failed: 0,
          multiplayer_match_completed: 0,
          multiplayer_push_connected: 0,
          multiplayer_push_disconnected: 0,
          multiplayer_push_fallback: 0,
        },
      }),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^settings$/i }));
    fireEvent.click(screen.getByRole('button', { name: /clear stats & history/i }));

    expect(window.confirm).toHaveBeenCalled();
    expect(localStorage.getItem(MATCH_HISTORY_KEY)).toBeNull();
    expect(localStorage.getItem(LIFETIME_STATS_KEY)).toBeNull();
    expect(localStorage.getItem(GROWTH_METRICS_KEY)).toBeNull();
  });

  it('blocks gameplay actions while paused and allows them again after resume', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));

    fireEvent.click(screen.getByRole('button', { name: /^pause$/i }));
    expect(screen.getByRole('dialog', { name: /game paused/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /\$1 card/i }));
    expect(mockedApplyAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^resume$/i }));
    fireEvent.click(screen.getByRole('button', { name: /\$1 card/i }));
    expect(mockedApplyAction).toHaveBeenCalledWith(expect.anything(), {
      type: 'play_to_bank',
      playerId: 'p1',
      cardId: 'money_1#a1',
    });
  });

  it('opens and closes the rules reference drawer via click and Escape', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));

    fireEvent.click(screen.getByRole('button', { name: /rules reference/i }));
    expect(screen.getByRole('dialog', { name: /rules reference/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    expect(screen.queryByRole('dialog', { name: /rules reference/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /rules reference/i }));
    expect(screen.getByRole('dialog', { name: /rules reference/i })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /rules reference/i })).not.toBeInTheDocument();
  });

  it('restores paused state when resuming a saved game after reload', () => {
    localStorage.setItem(
      ACTIVE_GAME_KEY,
      JSON.stringify({
        version: 1,
        timestamp: 1,
        gameState: baseState,
      }),
    );
    localStorage.setItem(
      UI_PREFERENCES_KEY,
      JSON.stringify({
        version: 1,
        reducedEffects: false,
        tableDensity: 'cozy',
        textScale: 'normal',
        devModeEnabled: false,
        gamePaused: true,
        pausedGameId: `${baseState.createdAt}`,
      }),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /resume saved game/i }));

    expect(screen.getByRole('heading', { name: /game table/i })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /game paused/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^resume$/i })).toBeInTheDocument();
  });

  it('opens saved games screen from home and returns back', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /saved games/i }));
    expect(screen.getByRole('heading', { name: /saved games/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByRole('heading', { name: /monopoly deal local/i })).toBeInTheDocument();
  });

  it('opens multiplayer screen with one-click controls and no server url field', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /play multiplayer/i }));

    expect(await screen.findByRole('heading', { name: /multiplayer/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/server url/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no local server setup required/i)).not.toBeInTheDocument();
    expect(screen.getByText(/local testing uses a local multiplayer service/i)).toBeInTheDocument();

    fetchSpy.mockRestore();
  });

  it('routes deep-link join URLs to multiplayer and prefills join code', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    window.history.pushState({}, '', '/join/abcde');

    render(<App />);

    expect(await screen.findByRole('heading', { name: /multiplayer/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/join code/i)).toHaveValue('ABCDE');
    const metrics = JSON.parse(localStorage.getItem(GROWTH_METRICS_KEY) ?? '{}') as { events?: Record<string, number> };
    expect(metrics.events?.multiplayer_deep_link_opened).toBe(1);

    fetchSpy.mockRestore();
  });

  it('shows local troubleshooting guidance when multiplayer health check fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network_unavailable'));

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /play multiplayer/i }));

    expect(await screen.findByText(/multiplayer server not reachable at/i)).toBeInTheDocument();
    expect(screen.getByText(/run npm run dev:lan:all/i)).toBeInTheDocument();

    fetchSpy.mockRestore();
  });

  it('copies invite links from hosted multiplayer lobby', async () => {
    const now = Date.now();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/multiplayer/health')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/multiplayer/rooms') && (!init?.method || init.method === 'POST')) {
        return new Response(
          JSON.stringify({
            roomCode: 'ABCDE',
            playerId: 'p1',
            sessionToken: 'token',
            reconnectDeadlineMs: now + 30_000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/multiplayer/rooms/ABCDE/state')) {
        return new Response(
          JSON.stringify({
            roomCode: 'ABCDE',
            status: 'lobby',
            started: false,
            hostPlayerId: 'p1',
            yourPlayerId: 'p1',
            players: [
              { id: 'p1', name: 'Host', handCount: 0, bankCount: 0, completeSets: 0, connected: true, lastSeenAt: now, reconnectDeadlineMs: now + 30_000, isHost: true, ready: false },
              { id: 'p2', name: 'Guest', handCount: 0, bankCount: 0, completeSets: 0, connected: true, lastSeenAt: now, reconnectDeadlineMs: now + 30_000, isHost: false, ready: false },
            ],
            legalActions: [],
            paused: false,
            revision: 2,
            turnSnapshotCount: 0,
            checkpointSlots: [],
            canStart: true,
            reconnectDeadlineMs: now + 30_000,
            serverTime: now,
            activityFeed: [],
            lastEventId: 2,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /play multiplayer/i }));
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: 'Host' } });
    fireEvent.click(screen.getByRole('button', { name: /host multiplayer game/i }));
    const copyInviteButton = await screen.findByRole('button', { name: /copy invite link/i });
    fireEvent.click(copyInviteButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringMatching(/\/join\/ABCDE$/));
    const metrics = JSON.parse(localStorage.getItem(GROWTH_METRICS_KEY) ?? '{}') as { events?: Record<string, number> };
    expect(metrics.events?.multiplayer_invite_copied).toBe(1);

    fetchSpy.mockRestore();
  });

  it('allows host to start lobby match from a checkpoint when available', async () => {
    const now = Date.now();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/multiplayer/health')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/multiplayer/rooms') && (!init?.method || init.method === 'POST')) {
        return new Response(
          JSON.stringify({
            roomCode: 'ABCDE',
            playerId: 'p1',
            sessionToken: 'token',
            reconnectDeadlineMs: now + 30_000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/multiplayer/rooms/ABCDE/state')) {
        return new Response(
          JSON.stringify({
            roomCode: 'ABCDE',
            status: 'lobby',
            started: false,
            hostPlayerId: 'p1',
            yourPlayerId: 'p1',
            players: [
              { id: 'p1', name: 'Host', handCount: 0, bankCount: 0, completeSets: 0, connected: true, lastSeenAt: now, reconnectDeadlineMs: now + 30_000, isHost: true },
              { id: 'p2', name: 'Guest', handCount: 0, bankCount: 0, completeSets: 0, connected: true, lastSeenAt: now, reconnectDeadlineMs: now + 30_000, isHost: false },
            ],
            legalActions: [],
            paused: false,
            revision: 2,
            turnSnapshotCount: 0,
            checkpointSlots: [{ id: 'cp-1', name: 'Checkpoint A', savedAt: now - 1_000 }],
            canStart: true,
            reconnectDeadlineMs: now + 30_000,
            serverTime: now,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/multiplayer/rooms/ABCDE/start')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.spyOn(window, 'prompt').mockReturnValue('1');

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /play multiplayer/i }));
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: 'Host' } });
    fireEvent.click(screen.getByRole('button', { name: /host multiplayer game/i }));
    expect(await screen.findByRole('button', { name: /start from checkpoint/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /start from checkpoint/i }));
    await waitFor(() => {
      expect(fetchSpy.mock.calls.some(([input]) => String(input).includes('/api/multiplayer/rooms/ABCDE/start'))).toBe(true);
    });
    const startCall = fetchSpy.mock.calls.find(([input]) => String(input).includes('/api/multiplayer/rooms/ABCDE/start'));
    expect(startCall).toBeDefined();
    if (!startCall) throw new Error('missing start call');
    const checkpointStartPayload = JSON.parse(String(startCall[1]?.body ?? '{}')) as Record<string, unknown>;
    expect(checkpointStartPayload.checkpointId).toBe('cp-1');

    fetchSpy.mockRestore();
  });

  it('renders the rich game table when multiplayer match is active', async () => {
    const multiplayerState = {
      ...structuredClone(baseState),
      players: [
        {
          ...baseState.players[0],
          hand: ['money_1#a1'],
        },
        {
          ...baseState.players[1],
          hand: ['__hidden__'],
        },
      ],
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/multiplayer/health')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/multiplayer/rooms') && (!init?.method || init.method === 'POST')) {
        return new Response(
          JSON.stringify({
            roomCode: 'ABCDE',
            playerId: 'p1',
            sessionToken: 'token',
            reconnectDeadlineMs: Date.now() + 30_000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/multiplayer/rooms/ABCDE/state')) {
        return new Response(
          JSON.stringify({
            roomCode: 'ABCDE',
            status: 'active',
            started: true,
            hostPlayerId: 'p1',
            yourPlayerId: 'p1',
            players: [
              {
                id: 'p1',
                name: 'Host',
                handCount: 1,
                bankCount: 0,
                completeSets: 0,
                connected: true,
                lastSeenAt: Date.now(),
                reconnectDeadlineMs: Date.now() + 30_000,
                isHost: true,
              },
              {
                id: 'p2',
                name: 'Guest',
                handCount: 1,
                bankCount: 1,
                completeSets: 0,
                connected: true,
                lastSeenAt: Date.now(),
                reconnectDeadlineMs: Date.now() + 30_000,
                isHost: false,
              },
            ],
            promptPlayerId: 'p1',
            legalActions: [
              { label: 'Pass turn', action: { type: 'pass_turn', playerId: 'p1' } },
            ],
            gameState: multiplayerState,
            paused: false,
            revision: 3,
            turnSnapshotCount: 0,
            checkpointSlots: [],
            canStart: false,
            reconnectDeadlineMs: Date.now() + 30_000,
            serverTime: Date.now(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /play multiplayer/i }));
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: 'Host' } });
    fireEvent.click(screen.getByRole('button', { name: /host multiplayer game/i }));

    expect(await screen.findByRole('heading', { name: /multiplayer table/i })).toBeInTheDocument();
    expect(screen.getByText(/connection: connected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /exit match/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /forget room/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show advanced legal actions/i }));
    expect(screen.getByRole('button', { name: /hide advanced legal actions/i })).toBeInTheDocument();
    expect(document.querySelector('.debug-action-list li')?.textContent).toMatch(/pass turn/i);

    fetchSpy.mockRestore();
  });

  it('opens rules drawer during an active multiplayer match', async () => {
    const multiplayerState = structuredClone(baseState);
    const now = Date.now();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/multiplayer/health')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/multiplayer/rooms')) {
        return new Response(
          JSON.stringify({
            roomCode: 'ABCDE',
            playerId: 'p1',
            sessionToken: 'token',
            reconnectDeadlineMs: now + 30_000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/multiplayer/rooms/ABCDE/state')) {
        return new Response(
          JSON.stringify({
            roomCode: 'ABCDE',
            status: 'active',
            started: true,
            hostPlayerId: 'p1',
            yourPlayerId: 'p1',
            players: [
              { id: 'p1', name: 'Host', handCount: 1, bankCount: 0, completeSets: 0, connected: true, lastSeenAt: now, reconnectDeadlineMs: now + 30_000, isHost: true },
              { id: 'p2', name: 'Guest', handCount: 1, bankCount: 1, completeSets: 0, connected: true, lastSeenAt: now, reconnectDeadlineMs: now + 30_000, isHost: false },
            ],
            promptPlayerId: 'p1',
            legalActions: [{ label: 'Pass turn', action: { type: 'pass_turn', playerId: 'p1' } }],
            gameState: multiplayerState,
            paused: false,
            revision: 3,
            turnSnapshotCount: 0,
            checkpointSlots: [],
            canStart: false,
            reconnectDeadlineMs: now + 30_000,
            serverTime: now,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /play multiplayer/i }));
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: 'Host' } });
    fireEvent.click(screen.getByRole('button', { name: /host multiplayer game/i }));
    expect(await screen.findByRole('heading', { name: /multiplayer table/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /rules reference/i }));
    expect(screen.getByRole('dialog', { name: /rules reference/i })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /rules reference/i })).not.toBeInTheDocument();
    });

    fetchSpy.mockRestore();
  });

  it('shows multiplayer winner overlay when the match is finished', async () => {
    const multiplayerState = {
      ...structuredClone(baseState),
      winnerId: 'p1',
    };
    const now = Date.now();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/multiplayer/health')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/multiplayer/rooms')) {
        return new Response(
          JSON.stringify({
            roomCode: 'ABCDE',
            playerId: 'p1',
            sessionToken: 'token',
            reconnectDeadlineMs: now + 30_000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/multiplayer/rooms/ABCDE/state')) {
        return new Response(
          JSON.stringify({
            roomCode: 'ABCDE',
            status: 'finished',
            started: true,
            winnerId: 'p1',
            hostPlayerId: 'p1',
            yourPlayerId: 'p1',
            players: [
              { id: 'p1', name: 'Host', handCount: 1, bankCount: 0, completeSets: 0, connected: true, lastSeenAt: now, reconnectDeadlineMs: now + 30_000, isHost: true },
              { id: 'p2', name: 'Guest', handCount: 1, bankCount: 1, completeSets: 0, connected: true, lastSeenAt: now, reconnectDeadlineMs: now + 30_000, isHost: false },
            ],
            promptPlayerId: 'p1',
            legalActions: [],
            gameState: multiplayerState,
            paused: false,
            revision: 3,
            turnSnapshotCount: 0,
            checkpointSlots: [],
            canStart: false,
            reconnectDeadlineMs: now + 30_000,
            serverTime: now,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /play multiplayer/i }));
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: 'Host' } });
    fireEvent.click(screen.getByRole('button', { name: /host multiplayer game/i }));
    const winnerDialog = await screen.findByRole('dialog', { name: /multiplayer winner/i });
    expect(winnerDialog).toBeInTheDocument();
    expect(within(winnerDialog).getByRole('button', { name: /exit match/i })).toBeInTheDocument();
    expect(within(winnerDialog).getByRole('button', { name: /forget room/i })).toBeInTheDocument();
    expect(screen.getByText(/winner:/i)).toHaveTextContent('Alpha');

    fetchSpy.mockRestore();
  });

  it('keeps reconnect session on exit match but clears it on forget room', async () => {
    const multiplayerState = structuredClone(baseState);
    const now = Date.now();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/multiplayer/health')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/multiplayer/rooms')) {
        return new Response(
          JSON.stringify({
            roomCode: 'ABCDE',
            playerId: 'p1',
            sessionToken: 'token',
            reconnectDeadlineMs: now + 30_000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/multiplayer/rooms/ABCDE/state')) {
        return new Response(
          JSON.stringify({
            roomCode: 'ABCDE',
            status: 'active',
            started: true,
            hostPlayerId: 'p1',
            yourPlayerId: 'p1',
            players: [
              { id: 'p1', name: 'Host', handCount: 1, bankCount: 0, completeSets: 0, connected: true, lastSeenAt: now, reconnectDeadlineMs: now + 30_000, isHost: true },
              { id: 'p2', name: 'Guest', handCount: 1, bankCount: 1, completeSets: 0, connected: true, lastSeenAt: now, reconnectDeadlineMs: now + 30_000, isHost: false },
            ],
            promptPlayerId: 'p1',
            legalActions: [{ label: 'Pass turn', action: { type: 'pass_turn', playerId: 'p1' } }],
            gameState: multiplayerState,
            paused: false,
            revision: 3,
            turnSnapshotCount: 0,
            checkpointSlots: [],
            canStart: false,
            reconnectDeadlineMs: now + 30_000,
            serverTime: now,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /play multiplayer/i }));
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: 'Host' } });
    fireEvent.click(screen.getByRole('button', { name: /host multiplayer game/i }));
    expect(await screen.findByRole('heading', { name: /multiplayer table/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /exit match/i }));
    expect(await screen.findByRole('heading', { name: /monopoly deal local/i })).toBeInTheDocument();
    expect(localStorage.getItem('monopolyDeal.multiplayerSession.v1')).toContain('ABCDE');

    fireEvent.click(screen.getByRole('button', { name: /play multiplayer/i }));
    expect(await screen.findByRole('heading', { name: /multiplayer/i })).toBeInTheDocument();
    expect(screen.getByText(/room abcde/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /forget room/i }));
    expect(await screen.findByRole('button', { name: /host multiplayer game/i })).toBeInTheDocument();
    expect(localStorage.getItem('monopolyDeal.multiplayerSession.v1')).toBeNull();

    fetchSpy.mockRestore();
  });

  it('saves current game to a slot and loads it from saved games', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /save game/i }));
    fireEvent.click(screen.getByRole('button', { name: /save current game/i }));

    const saved = JSON.parse(localStorage.getItem(SAVED_GAMES_KEY) ?? '{}');
    expect(saved.version).toBe(1);
    expect(saved.slots).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    fireEvent.click(screen.getByRole('button', { name: /home/i }));
    fireEvent.click(screen.getByRole('button', { name: /saved games/i }));
    fireEvent.click(screen.getByRole('button', { name: /^load$/i }));

    expect(screen.getByRole('heading', { name: /game table/i })).toBeInTheDocument();
  });

  it('renames and deletes saved game slots', () => {
    localStorage.setItem(
      SAVED_GAMES_KEY,
      JSON.stringify({
        version: 1,
        slots: [
          {
            id: 'slot_1',
            name: 'Original Slot',
            createdAt: 1,
            updatedAt: 1,
            gameState: baseState,
          },
        ],
      }),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /saved games/i }));
    fireEvent.click(screen.getByRole('button', { name: /^rename$/i }));

    let saved = JSON.parse(localStorage.getItem(SAVED_GAMES_KEY) ?? '{}');
    expect(saved.slots[0].name).toBe('Renamed Slot');

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    saved = JSON.parse(localStorage.getItem(SAVED_GAMES_KEY) ?? '{}');
    expect(saved.slots).toHaveLength(0);
  });

  it('does not carry paused state into a new match', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));
    fireEvent.click(screen.getByRole('button', { name: /^pause$/i }));
    expect(screen.getByRole('dialog', { name: /game paused/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /home/i }));
    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));

    expect(screen.queryByRole('dialog', { name: /game paused/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /\$1 card/i }));
    expect(mockedApplyAction).toHaveBeenCalledWith(expect.anything(), {
      type: 'play_to_bank',
      playerId: 'p1',
      cardId: 'money_1#a1',
    });
  });

  it('navigates to settings from both home and game screens', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /^settings$/i }));
    expect(screen.getByRole('heading', { name: /^settings$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByRole('heading', { name: /monopoly deal local/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    expect(screen.getByRole('heading', { name: /game table/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^settings$/i }));
    expect(screen.getByRole('heading', { name: /^settings$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByRole('heading', { name: /game table/i })).toBeInTheDocument();
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
        { id: 'p1', name: 'Alpha', controller: 'human', botDifficulty: 'easy' },
        { id: 'p2', name: 'Beta', controller: 'human', botDifficulty: 'easy' },
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

  it('shares post-game brag image and tracks success metrics', async () => {
    mockedApplyAction.mockImplementationOnce((state: GameState) => ({
      state: {
        ...state,
        winnerId: 'p1',
        turn: { ...state.turn, phase: 'finished' },
        updatedAt: state.updatedAt + 2_000,
        history: [{ timestamp: 100, type: 'action', message: 'Alpha won.' }],
      },
      events: [],
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));
    fireEvent.click(screen.getByRole('button', { name: /\$1 card/i }));
    await screen.findByRole('heading', { name: /alpha wins!/i });

    fireEvent.click(screen.getByRole('button', { name: /share brag image/i }));

    await screen.findByText(/brag image copied to your clipboard/i);
    expect(mockedGeneratePostGameSharePng).toHaveBeenCalledTimes(1);
    const metrics = JSON.parse(localStorage.getItem(GROWTH_METRICS_KEY) ?? '{}');
    expect(metrics.events.share_image_clicked).toBe(1);
    expect(metrics.events.share_image_success).toBe(1);
  });

  it('falls back to image download when clipboard write fails', async () => {
    mockedApplyAction.mockImplementationOnce((state: GameState) => ({
      state: {
        ...state,
        winnerId: 'p1',
        turn: { ...state.turn, phase: 'finished' },
        updatedAt: state.updatedAt + 3_000,
        history: [{ timestamp: 100, type: 'action', message: 'Alpha won again.' }],
      },
      events: [],
    }));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: {
        write: vi.fn().mockRejectedValue(new Error('clipboard blocked')),
      },
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));
    fireEvent.click(screen.getByRole('button', { name: /reveal turn/i }));
    fireEvent.click(screen.getByRole('button', { name: /\$1 card/i }));
    await screen.findByRole('heading', { name: /alpha wins!/i });

    fireEvent.click(screen.getByRole('button', { name: /share brag image/i }));

    await screen.findByText(/brag image downloaded/i);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const metrics = JSON.parse(localStorage.getItem(GROWTH_METRICS_KEY) ?? '{}');
    expect(metrics.events.share_image_clicked).toBe(1);
    expect(metrics.events.share_image_success).toBe(1);
    clickSpy.mockRestore();
  });
});
