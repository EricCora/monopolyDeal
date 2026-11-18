import { describe, expect, it } from 'vitest';
import { applyAction } from '../engine';
import { applyRoomAction, createRoom, joinRoom, roomView, setRoomReady, startRoom, type MultiplayerRoom } from '../../apps/server/src/gameService.ts';

function startedRoom() {
  const rooms = new Map<string, MultiplayerRoom>();
  const { room, session } = createRoom(rooms, 'Host');
  const guest = joinRoom(room, 'Guest');
  setRoomReady(room, session.playerId, session.sessionToken, true);
  setRoomReady(room, guest.playerId, guest.sessionToken, true);
  startRoom(room, session.playerId, session.sessionToken, 4242);
  const current = room.game!.players[room.game!.currentPlayerIndex].id;
  const [mover, other] = current === session.playerId ? [session, guest] : [guest, session];
  return { room, mover, other };
}

describe('god mode in rooms', () => {
  it('reveals the draw pile only to the seat whose turn it is, and only when asked', () => {
    const { room, mover, other } = startedRoom();
    const pile = room.game!.drawPile;
    expect(roomView(room, mover.playerId, mover.sessionToken).gameState?.drawPile.every((id) => id === '__hidden__')).toBe(true);
    expect(roomView(room, mover.playerId, mover.sessionToken, { revealDrawPile: true }).gameState?.drawPile).toEqual(pile);
    expect(roomView(room, other.playerId, other.sessionToken, { revealDrawPile: true }).gameState?.drawPile.every((id) => id === '__hidden__')).toBe(true);
  });

  it('accepts a draw that names its cards, and rejects one naming cards outside the pile', () => {
    const { room, mover, other } = startedRoom();
    const pick = [room.game!.drawPile[0], room.game!.drawPile[1]];
    expect(() => applyRoomAction(room, mover.playerId, mover.sessionToken, { type: 'draw_cards', playerId: mover.playerId, pick: [room.game!.players.find((p) => p.id === other.playerId)!.hand[0]] }))
      .toThrow();
    applyRoomAction(room, mover.playerId, mover.sessionToken, { type: 'draw_cards', playerId: mover.playerId, pick });
    expect(room.game!.players.find((p) => p.id === mover.playerId)!.hand.slice(-2)).toEqual(pick);
  });
});

describe('god mode in a room replay', () => {
  it('logs an ordinary draw and a chosen draw the same way, and both replay exactly', () => {
    for (const choose of [false, true]) {
      const { room, mover } = startedRoom();
      const pile = room.game!.drawPile;
      const pick = choose ? [pile[3], pile[7]] : undefined;
      applyRoomAction(room, mover.playerId, mover.sessionToken, { type: 'draw_cards', playerId: mover.playerId, ...(pick ? { pick } : {}) });
      const logged = room.replayLog!.actions[0];
      expect(Object.keys(logged).sort()).toEqual(['pick', 'playerId', 'type']);
      expect(logged.type === 'draw_cards' ? logged.pick : null).toEqual(room.game!.players.find((p) => p.id === mover.playerId)!.hand.slice(-2));
      const replayed = room.replayLog!.actions.reduce((state, action) => applyAction(state, action).state, room.replayLog!.initial);
      expect(replayed.players).toEqual(room.game!.players);
      expect(replayed.drawPile).toEqual(room.game!.drawPile);
    }
  });
});

describe('god mode request validation', () => {
  it('keeps a well-formed pick and refuses a malformed one', async () => {
    const { isValidMultiplayerAction } = await import('../../apps/server/src/validation.ts');
    const action = { type: 'draw_cards', playerId: 'p1', pick: ['money_1#a', 'pass_go#b'] };
    expect(isValidMultiplayerAction(action)).toBe(true);
    expect(isValidMultiplayerAction({ type: 'play_action', playerId: 'p1', cardId: 'pass_go#c', pick: ['money_1#a'] })).toBe(true);
    for (const pick of ['money_1#a', [''], [3], Array.from({ length: 8 }, (_, i) => `money_1#${i}`)]) {
      expect(isValidMultiplayerAction({ type: 'draw_cards', playerId: 'p1', pick })).toBe(false);
    }
  });
});
