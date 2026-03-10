import { beforeEach, describe, expect, it } from 'vitest';
import {
  canResumeRecoveryEntry,
  clearExpiredRecoveryEntries,
  loadRecoveryEntries,
  recoveryEntryToSession,
  saveRecoveryEntry,
} from '../persistence/multiplayerRecovery';

describe('multiplayer recovery storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('migrates the legacy stored multiplayer session into the recovery registry', () => {
    localStorage.setItem('monopolyDeal.multiplayerSession.v1', JSON.stringify({
      version: 1,
      roomCode: 'abcde',
      seatId: 'p2',
      resumeToken: 'token-2',
      playerId: 'p2',
      sessionToken: 'token-2',
      playerName: 'Guest',
      reconnectDeadlineMs: 1_700_000_030_000,
    }));

    const entries = loadRecoveryEntries(1_700_000_000_000);

    expect(entries).toHaveLength(1);
    expect(entries[0].roomCode).toBe('ABCDE');
    expect(entries[0].recoveryState).toBe('resumable');
    expect(recoveryEntryToSession(entries[0])?.playerId).toBe('p2');
    expect(localStorage.getItem('monopolyDeal.multiplayerSession.v1')).toBeNull();
  });

  it('upserts entries in a collection-ready way', () => {
    saveRecoveryEntry({
      roomCode: 'ABCDE',
      playerName: 'Guest',
      seatId: 'p2',
      resumeToken: 'token-2',
      playerId: 'p2',
      sessionToken: 'token-2',
      reconnectDeadlineMs: 1_700_000_030_000,
      recoveryState: 'resumable',
      lastSeenAt: 1_700_000_000_000,
    });
    saveRecoveryEntry({
      roomCode: 'FGHIJ',
      playerName: 'Host',
      seatId: 'p1',
      resumeToken: 'token-1',
      playerId: 'p1',
      sessionToken: 'token-1',
      reconnectDeadlineMs: 1_700_000_040_000,
      recoveryState: 'resume_failed',
      lastSeenAt: 1_700_000_010_000,
    });

    const entries = loadRecoveryEntries(1_700_000_000_000);

    expect(entries.map((entry) => entry.roomCode)).toEqual(['FGHIJ', 'ABCDE']);
    expect(canResumeRecoveryEntry(entries[0])).toBe(true);
  });

  it('clears terminal entries after the retention window', () => {
    saveRecoveryEntry({
      roomCode: 'ABCDE',
      playerName: 'Guest',
      reconnectDeadlineMs: 1_700_000_000_000,
      recoveryState: 'expired',
      lastSeenAt: 1_700_000_000_000,
    });

    const entries = clearExpiredRecoveryEntries(1_700_086_500_000);

    expect(entries).toEqual([]);
    expect(localStorage.getItem('monopolyDeal.multiplayerRecovery.v1')).toBeNull();
  });
});
