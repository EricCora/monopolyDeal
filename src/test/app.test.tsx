import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../engine';
import { createDevStatsFixture } from '../stats';
import App from '../App';
import { createStatsFixture } from './fixtures/statsFixtures';

const { mockedApplyAction, mockedCreateGame, mockedGetNextPrompt, mockedGetLegalActions, mockedIsGameOver } = vi.hoisted(() => ({
  mockedApplyAction: vi.fn(),
  mockedCreateGame: vi.fn(),
  mockedGetNextPrompt: vi.fn(),
  mockedGetLegalActions: vi.fn(),
  mockedIsGameOver: vi.fn(),
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

vi.mock('../ui/share/postGameShare', () => ({
  generatePostGameSharePng: mockedGeneratePostGameSharePng,
  postGameShareFilename: mockedPostGameShareFilename,
}));

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    mockedApplyAction.mockClear();
    mockedCreateGame.mockReset();
    mockedGetNextPrompt.mockReset();
    mockedGetLegalActions.mockReset();
    mockedIsGameOver.mockReset();
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
      },
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
