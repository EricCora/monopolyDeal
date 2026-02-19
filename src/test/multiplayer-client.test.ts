import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isLanResolvableHost,
  listMultiplayerLanOrigins,
  multiplayerErrorMessage,
  resolveMultiplayerApiBase,
} from '../network/multiplayerClient';

describe('resolveMultiplayerApiBase', () => {
  it('prefers env url over host/origin', () => {
    expect(resolveMultiplayerApiBase({
      envUrl: 'https://api.example.com/',
      hostname: 'localhost',
      origin: 'http://localhost:5173',
    })).toBe('https://api.example.com');
  });

  it('uses localhost server for localhost hostname when env is empty', () => {
    expect(resolveMultiplayerApiBase({
      envUrl: '',
      hostname: 'localhost',
      origin: 'http://localhost:5173',
    })).toBe('http://localhost:8787');
  });

  it('uses localhost server for 127.0.0.1 hostname', () => {
    expect(resolveMultiplayerApiBase({
      hostname: '127.0.0.1',
      origin: 'http://127.0.0.1:5173',
    })).toBe('http://localhost:8787');
  });

  it('uses localhost server for ::1 hostname', () => {
    expect(resolveMultiplayerApiBase({
      hostname: '::1',
      origin: 'http://[::1]:5173',
    })).toBe('http://localhost:8787');
  });

  it('uses origin for non-local hosts without env override', () => {
    expect(resolveMultiplayerApiBase({
      hostname: 'play.example.com',
      origin: 'https://play.example.com/',
    })).toBe('https://play.example.com');
  });

  it('falls back to localhost server without browser context', () => {
    expect(resolveMultiplayerApiBase({})).toBe('http://localhost:8787');
  });
});

describe('multiplayerErrorMessage', () => {
  it('maps revision conflict to refresh guidance', () => {
    expect(multiplayerErrorMessage('revision_conflict')).toMatch(/refresh/i);
  });

  it('maps room paused for user clarity', () => {
    expect(multiplayerErrorMessage('room_paused')).toMatch(/paused/i);
  });

  it('maps room started to reconnect guidance', () => {
    expect(multiplayerErrorMessage('room_started')).toMatch(/reconnect/i);
  });
});

describe('isLanResolvableHost', () => {
  it('returns false for localhost aliases', () => {
    expect(isLanResolvableHost('localhost')).toBe(false);
    expect(isLanResolvableHost('127.0.0.1')).toBe(false);
  });

  it('returns true for private LAN IPs and .local hosts', () => {
    expect(isLanResolvableHost('192.168.1.20')).toBe(true);
    expect(isLanResolvableHost('10.0.0.25')).toBe(true);
    expect(isLanResolvableHost('eric-macbook.local')).toBe(true);
  });
});

describe('listMultiplayerLanOrigins', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns LAN origins from dev endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ origins: ['http://192.168.86.243:5173'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(listMultiplayerLanOrigins('http://localhost:8787', 5173)).resolves.toEqual(['http://192.168.86.243:5173']);
  });
});
