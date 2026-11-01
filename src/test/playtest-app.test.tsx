import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, type GameState } from '../engine';
import App from '../App';
import { AppErrorBoundary } from '../ui/AppErrorBoundary';
import { pendingRequestBanner } from '../ui/screens/pendingRequestBanner';
import { getCardVisualModel } from '../ui/cards';
import { saveRecoveryEntry } from '../persistence/multiplayerRecovery';

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
});

describe('live table controls', () => {
  function stubRoom(hostPlayerId: 'p1' | 'p2') {
    const gameState = createGame({ seed: 5, players: [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bo' }] } as Parameters<typeof createGame>[0]);
    const now = Date.now();
    const leaves: unknown[] = [];
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/multiplayer/rooms')) {
        return json({ roomCode: 'ABCDE', playerId: 'p1', sessionToken: 'token', reconnectDeadlineMs: now + 30_000 });
      }
      if (url.includes('/leave')) leaves.push(init?.body);
      if (url.includes('/state')) {
        return json({
          roomCode: 'ABCDE', status: 'active', started: true, hostPlayerId, yourPlayerId: 'p1',
          players: [
            { id: 'p1', name: 'Ann', handCount: 5, bankCount: 0, completeSets: 0, connected: true, lastSeenAt: now, reconnectDeadlineMs: now + 30_000, isHost: hostPlayerId === 'p1' },
            { id: 'p2', name: 'Bo', handCount: 5, bankCount: 0, completeSets: 0, connected: true, lastSeenAt: now, reconnectDeadlineMs: now + 30_000, isHost: hostPlayerId === 'p2' },
          ],
          promptPlayerId: 'p1', legalActions: [{ label: 'Draw cards', action: { type: 'draw_cards', playerId: 'p1' } }],
          gameState, paused: false, revision: 3, turnSnapshotCount: 0, checkpointSlots: [], canStart: false,
          reconnectDeadlineMs: now + 30_000, serverTime: now,
        });
      }
      return json({ ok: true });
    }));
    return leaves;
  }

  async function openTable() {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /play multiplayer/i }));
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: 'Ann' } });
    fireEvent.click(await screen.findByRole('button', { name: /host multiplayer game/i }));
    await screen.findByRole('button', { name: /forget room/i }, { timeout: 4000 });
  }

  it('offers Pause to the host but not to a guest', async () => {
    stubRoom('p1');
    await openTable();
    expect(screen.getByRole('button', { name: /^pause$/i })).toBeInTheDocument();
  });

  it('hides Pause from a guest, whose click the server would reject', async () => {
    stubRoom('p2');
    await openTable();
    expect(screen.queryByRole('button', { name: /^pause$/i })).not.toBeInTheDocument();
  });

  it('keeps the seat when the Forget Room confirmation is declined', async () => {
    const leaves = stubRoom('p1');
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    await openTable();
    fireEvent.click(screen.getByRole('button', { name: /forget room/i }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(leaves).toEqual([]);
    expect(screen.getByRole('button', { name: /forget room/i })).toBeInTheDocument();
  });
});
