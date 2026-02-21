import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MultiplayerScreen } from '../ui/screens/MultiplayerScreen';

type MultiplayerScreenProps = ComponentProps<typeof MultiplayerScreen>;

function makeProps(overrides: Partial<MultiplayerScreenProps> = {}): MultiplayerScreenProps {
  return {
    playerName: 'Host',
    joinCode: 'HRCWM',
    session: null,
    roomView: null,
    loading: false,
    healthOk: true,
    apiBase: 'http://localhost:8787',
    isLocalDevApi: true,
    error: null,
    errorCode: null,
    recoveryNotice: null,
    connectionState: 'idle',
    pushState: 'disabled',
    isHost: false,
    onPlayerNameChange: vi.fn(),
    onJoinCodeChange: vi.fn(),
    onHostRoom: vi.fn(),
    onJoinRoom: vi.fn(),
    onStartMatch: vi.fn(),
    onRunAction: vi.fn(),
    onSetReady: vi.fn(),
    onCopyInviteLink: vi.fn(),
    onRefresh: vi.fn(),
    onLeaveRoom: vi.fn(),
    onClearRecoveryNotice: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
}

function makeSession() {
  return {
    version: 1 as const,
    roomCode: 'HRCWM',
    playerId: 'p1' as const,
    sessionToken: 'token',
    playerName: 'Host',
    reconnectDeadlineMs: Date.now() + 30_000,
  };
}

function makeLobbyView() {
  const now = Date.now();
  return {
    roomCode: 'HRCWM',
    status: 'lobby' as const,
    started: false,
    hostPlayerId: 'p1' as const,
    yourPlayerId: 'p1' as const,
    players: [
      {
        id: 'p1' as const,
        name: 'Host',
        handCount: 0,
        bankCount: 0,
        completeSets: 0,
        connected: true,
        lastSeenAt: now,
        reconnectDeadlineMs: now + 30_000,
        isHost: true,
        ready: false,
      },
    ],
    promptPlayerId: undefined,
    legalActions: [],
    gameState: undefined,
    winnerId: undefined,
    paused: false,
    pausedByPlayerId: undefined,
    revision: 1,
    turnSnapshotCount: 0,
    checkpointSlots: [],
    canStart: false,
    reconnectDeadlineMs: now + 30_000,
    serverTime: now,
    activityFeed: [],
    chatMessages: [],
    typingPlayerIds: [],
    lastEventId: 1,
  };
}

function makeLobbyViewWithActivity() {
  const now = Date.now();
  const base = makeLobbyView();
  return {
    ...base,
    activityFeed: [
      {
        id: 1,
        createdAt: now,
        kind: 'lobby' as const,
        message: 'Host created room.',
      },
    ],
  };
}

function makeLobbyViewWithTurnState() {
  const now = Date.now();
  const base = makeLobbyView();
  return {
    ...base,
    promptPlayerId: 'p2',
    legalActions: [
      {
        label: 'Pass Turn',
        action: {
          type: 'pass_turn' as const,
          playerId: 'p1',
        },
      },
    ],
    checkpointSlots: [
      {
        id: 'cp_1',
        name: 'Turn 4',
        savedAt: now - 20_000,
      },
    ],
    players: [
      {
        id: 'p1' as const,
        name: 'Host',
        handCount: 2,
        bankCount: 1,
        completeSets: 0,
        connected: true,
        lastSeenAt: now,
        reconnectDeadlineMs: now + 30_000,
        isHost: true,
        ready: true,
      },
      {
        id: 'p2' as const,
        name: 'Guest',
        handCount: 1,
        bankCount: 0,
        completeSets: 0,
        connected: false,
        lastSeenAt: now - 9_000,
        reconnectDeadlineMs: now + 25_000,
        isHost: false,
        ready: false,
      },
    ],
  };
}

describe('MultiplayerScreen', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ origins: ['http://192.168.86.243:5173'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows a stale-session recovery card instead of endless syncing when room is gone', () => {
    render(
      <MultiplayerScreen
        {...makeProps({
          session: {
            version: 1,
            roomCode: 'HRCWM',
            playerId: 'p1',
            sessionToken: 'token',
            playerName: 'Host',
            reconnectDeadlineMs: Date.now() + 30_000,
          },
          errorCode: 'room_not_found',
        })}
      />,
    );

    expect(screen.getByText(/room session ended/i)).toBeInTheDocument();
    expect(screen.queryByText(/syncing room/i)).not.toBeInTheDocument();
  });

  it('shows recovery notice above host/join cards when stale session was auto-cleared', () => {
    render(
      <MultiplayerScreen
        {...makeProps({
          recoveryNotice: { roomCode: 'HRCWM', reason: 'reconnect_expired' },
        })}
      />,
    );

    expect(screen.getByText(/previous room unavailable/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('HRCWM')).toBeInTheDocument();
    expect(screen.getByText(/reconnect window expired/i)).toBeInTheDocument();
  });

  it('keeps syncing placeholder only for live reconnecting/loading states', () => {
    render(
      <MultiplayerScreen
        {...makeProps({
          loading: true,
          session: {
            version: 1,
            roomCode: 'HRCWM',
            playerId: 'p1',
            sessionToken: 'token',
            playerName: 'Host',
            reconnectDeadlineMs: Date.now() + 30_000,
          },
          connectionState: 'reconnecting',
        })}
      />,
    );

    expect(screen.getByText(/syncing room/i)).toBeInTheDocument();
  });

  it('shows a copy notice when room code is copied', async () => {
    render(
      <MultiplayerScreen
        {...makeProps({
          session: makeSession(),
          roomView: makeLobbyView(),
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /copy room code/i }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('HRCWM');
    });
    expect(screen.getByText(/room code copied/i)).toBeInTheDocument();
  });

  it('shows a copy notice when invite link is copied', async () => {
    render(
      <MultiplayerScreen
        {...makeProps({
          session: makeSession(),
          roomView: makeLobbyView(),
        })}
      />,
    );
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: /copy invite link/i }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://192.168.86.243:5173/join/HRCWM');
    });
    await waitFor(() => {
      expect(screen.getByText(/invite link copied/i)).toBeInTheDocument();
    });
  });

  it('falls back to room code notice when LAN invite origin resolution fails', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ origins: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(
      <MultiplayerScreen
        {...makeProps({
          session: makeSession(),
          roomView: makeLobbyView(),
        })}
      />,
    );
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: /copy invite link/i }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('HRCWM');
    });
    await waitFor(() => {
      expect(screen.getByText(/room code copied instead/i)).toBeInTheDocument();
    });
  });

  it('auto-dismisses copy notices after the timeout', async () => {
    vi.useFakeTimers();

    render(
      <MultiplayerScreen
        {...makeProps({
          session: makeSession(),
          roomView: makeLobbyView(),
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /copy room code/i }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText(/room code copied/i)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2_250);
    });

    expect(screen.queryByText(/room code copied/i)).not.toBeInTheDocument();
  });

  it('allows collapsing and expanding recent activity in lobby', async () => {
    render(
      <MultiplayerScreen
        {...makeProps({
          session: makeSession(),
          roomView: makeLobbyViewWithActivity(),
        })}
      />,
    );

    expect(screen.getByText(/host created room/i)).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /hide/i });
    fireEvent.click(toggle);

    expect(screen.queryByText(/host created room/i)).not.toBeInTheDocument();
    expect(screen.getByText(/expand activity to review recent room events/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show/i }));
    expect(screen.getByText(/host created room/i)).toBeInTheDocument();
  });

  it('shows lobby snapshot and current-turn tagging', () => {
    render(
      <MultiplayerScreen
        {...makeProps({
          session: makeSession(),
          roomView: makeLobbyViewWithTurnState(),
        })}
      />,
    );

    expect(screen.getByText(/turn: guest/i)).toBeInTheDocument();
    const snapshot = screen.getByLabelText(/lobby snapshot/i);
    expect(within(snapshot).getByText('2')).toBeInTheDocument();
    expect(within(snapshot).getAllByText('1/2').length).toBeGreaterThan(0);
    expect(screen.getByText('Turn', { selector: '.multiplayer-player-tag' })).toBeInTheDocument();
  });
});
