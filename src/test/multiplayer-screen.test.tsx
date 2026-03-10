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
    connectionUiState: 'connected',
    pushState: 'disabled',
    isHost: false,
    onPlayerNameChange: vi.fn(),
    onJoinCodeChange: vi.fn(),
    onHostRoom: vi.fn(),
    onJoinRoom: vi.fn(),
    onStartMatch: vi.fn(),
    onRunAction: vi.fn(),
    onSetReady: vi.fn(),
    onSetRoomPreset: vi.fn(),
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
    presetId: 'standard' as const,
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
    canRematch: false,
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

  it('renders a Resume Your Room card with resume and forget actions', () => {
    const onResumeStoredRoom = vi.fn();
    const onForgetStoredRoom = vi.fn();

    render(
      <MultiplayerScreen
        {...makeProps({
          recoveryEntry: {
            roomCode: 'HRCWM',
            playerName: 'Guest',
            seatId: 'p2',
            resumeToken: 'token-2',
            playerId: 'p2',
            sessionToken: 'token-2',
            reconnectDeadlineMs: Date.now() + 30_000,
            lastKnownStatus: 'active',
            lastKnownRuntimeState: 'paused_disconnect',
            recoveryState: 'resumable',
            lastSeenAt: Date.now(),
          },
          onResumeStoredRoom,
          onForgetStoredRoom,
        })}
      />,
    );

    expect(screen.getByText(/resume your room/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/resume your room/i)).toHaveTextContent(/room\s+hrcwm\s+as\s+guest/i);
    fireEvent.click(screen.getByRole('button', { name: /resume room/i }));
    fireEvent.click(screen.getByRole('button', { name: /forget this room/i }));

    expect(onResumeStoredRoom).toHaveBeenCalledTimes(1);
    expect(onForgetStoredRoom).toHaveBeenCalledTimes(1);
  });

  it('disables resume for terminal recovery entries', () => {
    render(
      <MultiplayerScreen
        {...makeProps({
          recoveryEntry: {
            roomCode: 'HRCWM',
            playerName: 'Guest',
            reconnectDeadlineMs: Date.now() - 1_000,
            recoveryState: 'expired',
            lastSeenAt: Date.now(),
          },
        })}
      />,
    );

    expect(screen.getByRole('button', { name: /resume room/i })).toBeDisabled();
    expect(screen.getByText(/reconnect expired/i)).toBeInTheDocument();
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

  it('renders reconnect-ui status copy for scaffolded ui states', () => {
    render(
      <MultiplayerScreen
        {...makeProps({
          session: makeSession(),
          roomView: makeLobbyView(),
          connectionState: 'connected',
          connectionUiState: 'resync_pending',
        })}
      />,
    );

    expect(screen.getByText(/syncing state/i)).toBeInTheDocument();
    expect(screen.getByText(/seat restored\. syncing authoritative room state/i)).toBeInTheDocument();
  });

  it('renders terminal reconnect-ui status copy for timed_out, room_ended, and resume_failed', () => {
    vi.useFakeTimers();
    vi.mocked(globalThis.fetch).mockImplementation(
      () => new Promise<Response>(() => {}),
    );
    const { rerender } = render(
      <MultiplayerScreen
        {...makeProps({
          session: makeSession(),
          roomView: makeLobbyView(),
          connectionState: 'disconnected',
          connectionUiState: 'timed_out',
        })}
      />,
    );
    expect(screen.getByText(/reconnect window expired/i)).toBeInTheDocument();

    act(() => {
      rerender(
        <MultiplayerScreen
          {...makeProps({
            session: makeSession(),
            roomView: makeLobbyView(),
            connectionState: 'disconnected',
            connectionUiState: 'room_ended',
          })}
        />,
      );
    });
    expect(screen.getByText(/room is no longer available/i)).toBeInTheDocument();

    act(() => {
      rerender(
        <MultiplayerScreen
          {...makeProps({
            session: makeSession(),
            roomView: makeLobbyView(),
            connectionState: 'disconnected',
            connectionUiState: 'resume_failed',
          })}
        />,
      );
    });
    expect(screen.getByText(/could not resume this seat automatically/i)).toBeInTheDocument();
  });

  it('renders socket-disconnected and reconnecting status labels in reconnect ui mode', () => {
    vi.useFakeTimers();
    vi.mocked(globalThis.fetch).mockImplementation(
      () => new Promise<Response>(() => {}),
    );
    const { rerender } = render(
      <MultiplayerScreen
        {...makeProps({
          session: makeSession(),
          roomView: makeLobbyView(),
          connectionState: 'reconnecting',
          connectionUiState: 'socket_disconnected',
        })}
      />,
    );

    expect(screen.getByText(/socket disconnected/i)).toBeInTheDocument();

    act(() => {
      rerender(
        <MultiplayerScreen
          {...makeProps({
            session: makeSession(),
            roomView: makeLobbyView(),
            connectionState: 'reconnecting',
            connectionUiState: 'reconnecting_attempting',
          })}
        />,
      );
    });
    expect(screen.getByText(/connection lost\. attempting automatic reconnect/i)).toBeInTheDocument();
  });

  it('renders polling fallback status when live-update bootstrap does not connect', () => {
    render(
      <MultiplayerScreen
        {...makeProps({
          session: makeSession(),
          roomView: makeLobbyView(),
          connectionState: 'connected',
          pushState: 'fallback',
        })}
      />,
    );

    expect(screen.getByText(/live updates unavailable, using polling/i)).toBeInTheDocument();
  });

  it('renders host disconnect pause banner copy from room runtime state', () => {
    render(
      <MultiplayerScreen
        {...makeProps({
          session: makeSession(),
          roomView: {
            ...makeLobbyView(),
            roomRuntimeState: 'paused_host_disconnect',
            pausedReason: 'host_disconnect',
          },
          connectionState: 'connected',
        })}
      />,
    );

    expect(screen.getByText(/host disconnected\. room is paused until host reconnects or times out/i)).toBeInTheDocument();
  });

  it('renders host timeout room-ended banner and blocks room actions', () => {
    render(
      <MultiplayerScreen
        {...makeProps({
          session: makeSession(),
          roomView: {
            ...makeLobbyViewWithTurnState(),
            roomRuntimeState: 'ended_timeout',
            endedReason: 'host_timeout',
          },
          connectionState: 'connected',
          isHost: true,
        })}
      />,
    );

    expect(screen.getByText(/host timed out\. room ended/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /forget room/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /copy invite link/i })).toBeDisabled();
  });

  it('renders connected live-updates status when stream is active', () => {
    render(
      <MultiplayerScreen
        {...makeProps({
          session: makeSession(),
          roomView: makeLobbyView(),
          connectionState: 'connected',
          pushState: 'connected',
        })}
      />,
    );

    expect(screen.getByText(/live updates active/i)).toBeInTheDocument();
  });

  it('shows preset cards and ready-gated host controls in the lobby', () => {
    const now = Date.now();
    render(
      <MultiplayerScreen
        {...makeProps({
          session: makeSession(),
          roomView: {
            ...makeLobbyView(),
            players: [
              {
                id: 'p1',
                name: 'Host',
                handCount: 0,
                bankCount: 0,
                completeSets: 0,
                connected: true,
                lastSeenAt: now,
                reconnectDeadlineMs: now + 30_000,
                isHost: true,
                ready: true,
              },
              {
                id: 'p2',
                name: 'Guest',
                handCount: 0,
                bankCount: 0,
                completeSets: 0,
                connected: true,
                lastSeenAt: now,
                reconnectDeadlineMs: now + 30_000,
                isHost: false,
                ready: false,
              },
            ],
          },
          isHost: true,
        })}
      />,
    );

    expect(screen.getByText(/session: live online · standard/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /standard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fast/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /teaching/i })).toBeInTheDocument();
    expect(screen.getByText(/waiting on ready check for guest/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start match/i })).toBeDisabled();
  });

  it('renders reconnect debug panel only when reconnect debug is enabled', async () => {
    const diagnostics = {
      roomCode: 'HRCWM',
      seatId: 'p1',
      pushState: 'connected' as const,
      transportMode: 'socket_primary' as const,
      reconnectAttempt: 2,
      lastClientVersion: 5,
      lastServerVersion: 6,
      lastReconnectError: null,
      roomRuntimeState: 'active' as const,
      pausedReason: null,
      endedReason: null,
    };
    const { rerender } = render(
      <MultiplayerScreen
        {...makeProps({
          session: null,
          roomView: null,
          reconnectDebugEnabled: true,
          reconnectDiagnostics: diagnostics,
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/reconnect debug/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/room=HRCWM seat=p1 push=connected/i)).toBeInTheDocument();

    rerender(
      <MultiplayerScreen
        {...makeProps({
          session: null,
          roomView: null,
          reconnectDebugEnabled: false,
          reconnectDiagnostics: diagnostics,
        })}
      />,
    );
    expect(screen.queryByText(/reconnect debug/i)).not.toBeInTheDocument();
  });

  it('shows always-on multiplayer policy status in dev chip when enabled', () => {
    render(
      <MultiplayerScreen
        {...makeProps({
          session: makeSession(),
          roomView: makeLobbyViewWithTurnState(),
          showDevStatusChip: true,
          pushState: 'connected',
        })}
      />,
    );

    expect(screen.getByText(/dev status: reconnect policy active/i)).toBeInTheDocument();
    expect(screen.getByText(/live updates connected/i)).toBeInTheDocument();
  });

  it('disables actionable lobby controls while reconnect ui is blocking input', () => {
    render(
      <MultiplayerScreen
        {...makeProps({
          session: makeSession(),
          roomView: makeLobbyViewWithTurnState(),
          isHost: true,
          connectionState: 'reconnecting',
          connectionUiState: 'reconnecting_attempting',
        })}
      />,
    );

    expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /forget room/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /copy invite link/i })).toBeDisabled();
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
