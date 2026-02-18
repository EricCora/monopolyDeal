import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

describe('MultiplayerScreen', () => {
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
});
