import { afterEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const socket = {
    connected: false,
    on: (name: string, fn: (...args: unknown[]) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(fn);
      return socket;
    },
    off: (name: string, fn: (...args: unknown[]) => void) => {
      listeners.get(name)?.delete(fn);
      return socket;
    },
    emit: vi.fn(),
    connect: () => socket,
    disconnect: () => socket,
    removeAllListeners: () => socket,
  };
  return { socket, fire: (name: string) => listeners.get(name)?.forEach((fn) => fn()) };
});

vi.mock('socket.io-client', () => ({ io: () => fake.socket }));

import { getMultiplayerTransportMode, subscribeMultiplayerRoomEvents } from '../network/multiplayerClient';

const session = { roomCode: 'ABCDE', playerId: 'p1', seatId: 'p1', sessionToken: 't', resumeToken: 't', playerName: 'A', reconnectDeadlineMs: 0 };

afterEach(() => {
  vi.useRealTimers();
});

describe('room event subscription', () => {
  it('uses a socket that is already connected instead of timing out to fallback', () => {
    vi.useFakeTimers();
    const first = subscribeMultiplayerRoomEvents(session as never, { onEvent: () => undefined }, 'http://api');
    fake.socket.connected = true;
    fake.fire('connect');
    first.close();

    const onOpen = vi.fn();
    subscribeMultiplayerRoomEvents(session as never, { onEvent: () => undefined, onOpen }, 'http://api');
    vi.advanceTimersByTime(60_000);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(getMultiplayerTransportMode()).toBe('socket_primary');
  });
});
