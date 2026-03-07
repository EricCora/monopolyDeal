import { describe, expect, it } from 'vitest';
import { SocketSessionRegistry } from '../../apps/server/src/socketSessionRegistry.ts';

describe('server socket session registry', () => {
  it('flags duplicate raw socket connects while a seat already has an active binding', () => {
    const registry = new SocketSessionRegistry();
    registry.bind('socket-a', {
      roomCode: 'ROOM1',
      seatId: 'p1',
      sessionToken: 'token-a',
    });

    expect(registry.hasActiveConflict('ROOM1', 'p1', 'socket-b')).toBe(true);
    expect(registry.hasActiveConflict('ROOM1', 'p1', 'socket-a')).toBe(false);
  });

  it('consumes server-initiated disconnect suppression once', () => {
    const registry = new SocketSessionRegistry();
    registry.markServerInitiatedDisconnect('socket-a');

    expect(registry.consumeServerInitiatedDisconnect('socket-a')).toBe(true);
    expect(registry.consumeServerInitiatedDisconnect('socket-a')).toBe(false);
  });

  it('keeps the replacement binding active when the replaced socket is later unbound', () => {
    const registry = new SocketSessionRegistry();
    registry.bind('socket-a', {
      roomCode: 'ROOM1',
      seatId: 'p1',
      sessionToken: 'token-a',
    });

    const replacedSocketId = registry.bind('socket-b', {
      roomCode: 'ROOM1',
      seatId: 'p1',
      sessionToken: 'token-b',
    });
    registry.markServerInitiatedDisconnect('socket-a');

    expect(replacedSocketId).toBe('socket-a');
    expect(registry.consumeServerInitiatedDisconnect('socket-a')).toBe(true);
    expect(registry.unbind('socket-a')?.sessionToken).toBe('token-a');
    expect(registry.getActiveSocketId('ROOM1', 'p1')).toBe('socket-b');
    expect(registry.getBinding('socket-b')?.sessionToken).toBe('token-b');
  });
});
