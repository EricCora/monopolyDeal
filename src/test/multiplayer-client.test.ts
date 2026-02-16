import { describe, expect, it } from 'vitest';
import { multiplayerErrorMessage, resolveMultiplayerApiBase } from '../network/multiplayerClient';

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
});
