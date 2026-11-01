import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, type GameState } from '../engine';
import App from '../App';
import { AppErrorBoundary } from '../ui/AppErrorBoundary';
import { pendingRequestBanner } from '../ui/screens/GameTableScreen';
import { getCardVisualModel } from '../ui/cards';
import { saveRecoveryEntry } from '../persistence/multiplayerRecovery';
import { readFileSync } from 'node:fs';

beforeEach(() => {
  localStorage.clear();
  window.history.pushState({}, '', '/');
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(() => false),
    })),
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
});

describe('Practice vs Bots', () => {
  it('skips the pass-and-play screen and the bot takes its turn with default settings', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /practice vs bots/i }));
    expect(screen.queryByRole('button', { name: /reveal turn/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /draw cards/i }));
    fireEvent.click(await screen.findByRole('button', { name: /pass turn/i }));
    await act(async () => {
      await new Promise((resolve) => { window.setTimeout(resolve, 1500); });
    });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/House Bot drew/);
    }, { timeout: 4000 });
  }, 15_000);
});

describe('No Mercy table', () => {
  it('names a No Mercy-only card in the response banner', () => {
    const game: GameState = createGame({ seed: 1, variant: 'no_mercy', players: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }] } as Parameters<typeof createGame>[0]);
    game.pending = {
      kind: 'counter',
      payload: { sourcePlayerId: 'p1', awaitingPlayerId: 'p2', actionCardId: 'tough_luck#3' },
    } as GameState['pending'];
    expect(pendingRequestBanner(game, 'p2')?.detail).toMatch(/A played Tough Luck/);
  });
});

describe('render failures', () => {
  it('shows a recovery screen instead of a blank page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Broken = () => { throw new Error('boom'); };
    render(<AppErrorBoundary><Broken /></AppErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });
});

describe('returning to a live room', () => {
  const entry = {
    roomCode: 'ABCDE',
    playerName: 'Ann',
    seatId: 'p1',
    resumeToken: 't',
    playerId: 'p1',
    sessionToken: 't',
    reconnectDeadlineMs: Date.now() + 60_000,
    lastKnownStatus: 'active' as const,
    lastKnownRuntimeState: 'active' as const,
    recoveryState: 'reconnecting' as const,
    lastSeenAt: Date.now(),
  };

  it('opens the multiplayer screen on load', () => {
    saveRecoveryEntry(entry);
    render(<App />);
    expect(screen.queryByText(/choose your format/i)).not.toBeInTheDocument();
  });

  it('stays on Home after the player exited that room on purpose', () => {
    saveRecoveryEntry({ ...entry, userExited: true });
    render(<App />);
    expect(screen.getByText(/choose your format/i)).toBeInTheDocument();
  });
});

describe('table copy and controls', () => {
  it('formats every underscore in a card badge', () => {
    expect(getCardVisualModel('its_my_birthday#1').actionBadge).toBe('Its My Birthday');
    expect(getCardVisualModel('just_say_no#1').actionBadge).toBe('Just Say No');
  });

  const table = readFileSync('src/ui/screens/GameTableScreen.tsx', 'utf8');
  const home = readFileSync('src/ui/screens/HomeScreen.tsx', 'utf8');

  it('offers Pause only to the host in a live room', () => {
    expect(table).toMatch(/\(!isMultiplayer \|\| isMultiplayerHost\) \? <button onClick=\{onPauseToggle\}/);
  });

  it('confirms before forgetting a room', () => {
    expect(table).toMatch(/window\.confirm\([^)]*[Ff]orget/);
  });

  it('does not call the online game Local', () => {
    expect(home).not.toContain('Monopoly Deal Local');
  });
});
