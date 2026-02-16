import { describe, expect, it } from 'vitest';
import {
  applyRoomAction,
  createRoom,
  joinRoom,
  leaveRoom,
  loadRoomCheckpoint,
  pauseRoom,
  pruneInactiveRooms,
  resetTurnRoomActions,
  resumeRoom,
  roomView,
  saveRoomCheckpoint,
  startRoom,
  undoRoomAction,
  type MultiplayerRoom,
} from '../../apps/server/src/gameService.ts';

function findParticipant(room: MultiplayerRoom, playerId: string) {
  const participant = room.players.find((player) => player.id === playerId);
  expect(participant).toBeDefined();
  if (!participant) {
    throw new Error(`Missing participant ${playerId}`);
  }
  return participant;
}

function fillLobby(room: MultiplayerRoom) {
  const p2 = joinRoom(room, 'Player 2');
  const p3 = joinRoom(room, 'Player 3');
  const p4 = joinRoom(room, 'Player 4');
  return [p2, p3, p4];
}

describe('multiplayer room service lifecycle', () => {
  it('refreshes room activity timestamp on state polls', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    room.updatedAt = Date.now() - 31 * 60 * 1000;
    const previousUpdatedAt = room.updatedAt;

    roomView(room, session.playerId, session.sessionToken);

    expect(room.updatedAt).toBeGreaterThan(previousUpdatedAt);
  });

  it('keeps active room alive when poll heartbeat precedes prune', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    const now = Date.now();
    room.updatedAt = now - 31 * 60 * 1000;

    roomView(room, session.playerId, session.sessionToken);
    pruneInactiveRooms(rooms, now + 1_000);

    expect(rooms.has(room.code)).toBe(true);
  });

  it('reclaims expired disconnected lobby seats before enforcing room capacity', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room } = createRoom(rooms, 'Host');
    const [playerTwo] = fillLobby(room);
    const disconnected = findParticipant(room, playerTwo.playerId);
    disconnected.connected = false;
    disconnected.reconnectDeadlineMs = Date.now() - 1;

    const joined = joinRoom(room, 'Replacement');

    expect(joined.playerId).toBe(playerTwo.playerId);
    expect(room.players).toHaveLength(4);
    expect(new Set(room.players.map((player) => player.id)).size).toBe(4);
  });

  it('still rejects joins when disconnected seats are inside reconnect grace window', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room } = createRoom(rooms, 'Host');
    const [playerTwo] = fillLobby(room);
    const disconnected = findParticipant(room, playerTwo.playerId);
    disconnected.connected = false;
    disconnected.reconnectDeadlineMs = Date.now() + 60_000;

    expect(() => joinRoom(room, 'Replacement')).toThrowError('room_full');
  });

  it('rejects room state access after reconnect window expiration', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');
    leaveRoom(room, playerTwo.playerId, playerTwo.sessionToken);
    const disconnected = findParticipant(room, playerTwo.playerId);
    disconnected.reconnectDeadlineMs = Date.now() - 1;

    expect(() => roomView(room, playerTwo.playerId, playerTwo.sessionToken)).toThrowError('reconnect_expired');
    expect(disconnected.connected).toBe(false);
  });

  it('allows room state access for disconnected players within reconnect grace window', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');
    leaveRoom(room, playerTwo.playerId, playerTwo.sessionToken);
    const disconnected = findParticipant(room, playerTwo.playerId);
    disconnected.reconnectDeadlineMs = Date.now() + 60_000;

    const view = roomView(room, playerTwo.playerId, playerTwo.sessionToken);

    expect(view.yourPlayerId).toBe(playerTwo.playerId);
    expect(disconnected.connected).toBe(true);
  });

  it('enforces host-only pause and resume', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');
    startRoom(room, session.playerId, session.sessionToken);

    expect(() => pauseRoom(room, playerTwo.playerId, playerTwo.sessionToken)).toThrowError('host_required');

    pauseRoom(room, session.playerId, session.sessionToken);
    expect(room.paused).toBe(true);

    resumeRoom(room, session.playerId, session.sessionToken);
    expect(room.paused).toBe(false);
  });

  it('supports undo and reset-turn snapshots for the active player', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    joinRoom(room, 'Player 2');
    startRoom(room, session.playerId, session.sessionToken);

    const initialView = roomView(room, session.playerId, session.sessionToken);
    const firstAction = initialView.legalActions.find((entry) => entry.action.type === 'draw_cards')?.action ?? initialView.legalActions[0]?.action;
    expect(firstAction).toBeDefined();
    if (!firstAction) throw new Error('missing legal action');

    applyRoomAction(room, session.playerId, session.sessionToken, firstAction);
    expect(room.turnSnapshots.length).toBeGreaterThan(0);

    undoRoomAction(room, session.playerId, session.sessionToken);
    expect(room.turnSnapshots.length).toBe(0);

    const refreshed = roomView(room, session.playerId, session.sessionToken);
    const drawAgain = refreshed.legalActions.find((entry) => entry.action.type === 'draw_cards')?.action ?? refreshed.legalActions[0]?.action;
    expect(drawAgain).toBeDefined();
    if (!drawAgain) throw new Error('missing legal action');
    applyRoomAction(room, session.playerId, session.sessionToken, drawAgain);
    resetTurnRoomActions(room, session.playerId, session.sessionToken);
    expect(room.turnSnapshots.length).toBe(0);
  });

  it('saves and loads checkpoints, clearing turn snapshots', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    joinRoom(room, 'Player 2');
    startRoom(room, session.playerId, session.sessionToken);

    const checkpoint = saveRoomCheckpoint(room, session.playerId, session.sessionToken, 'Start');
    expect(checkpoint.name).toBe('Start');
    expect(room.checkpoints).toHaveLength(1);

    const view = roomView(room, session.playerId, session.sessionToken);
    const action = view.legalActions.find((entry) => entry.action.type === 'draw_cards')?.action ?? view.legalActions[0]?.action;
    expect(action).toBeDefined();
    if (!action) throw new Error('missing legal action');
    applyRoomAction(room, session.playerId, session.sessionToken, action);
    expect(room.turnSnapshots.length).toBeGreaterThan(0);

    loadRoomCheckpoint(room, session.playerId, session.sessionToken, checkpoint.id);
    expect(room.turnSnapshots.length).toBe(0);
  });

  it('rejects stale expected revision on mutating actions', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    joinRoom(room, 'Player 2');
    startRoom(room, session.playerId, session.sessionToken);
    const staleRevision = room.revision - 1;

    expect(() => pauseRoom(room, session.playerId, session.sessionToken, staleRevision)).toThrowError('revision_conflict');
  });

  it('allows leave with stale expected revision for valid session cleanup', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');
    startRoom(room, session.playerId, session.sessionToken);
    const staleRevision = room.revision - 1;

    leaveRoom(room, playerTwo.playerId, playerTwo.sessionToken, staleRevision);

    const disconnected = findParticipant(room, playerTwo.playerId);
    expect(disconnected.connected).toBe(false);
  });

  it('accepts manual pay_request card order when cards are otherwise legal', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');
    startRoom(room, session.playerId, session.sessionToken);

    if (!room.game) throw new Error('expected game');
    const payer = room.game.players.find((player) => player.id === playerTwo.playerId);
    if (!payer) throw new Error('expected payer');
    payer.bank = ['money_1#pay1', 'money_2#pay2'];
    payer.properties = {
      brown: [],
      light_blue: [],
      pink: [],
      orange: [],
      red: [],
      yellow: [],
      green: [],
      dark_blue: [],
      railroad: [],
      utility: [],
    };
    room.game.pending = {
      kind: 'payment',
      payload: {
        sourcePlayerId: session.playerId,
        targetPlayerId: playerTwo.playerId,
        amount: 3,
        reason: 'rent',
        actionCardId: 'rent#test',
      },
    };

    const legal = roomView(room, playerTwo.playerId, playerTwo.sessionToken).legalActions;
    const payAction = legal.find((entry) => entry.action.type === 'pay_request' && entry.action.cards.length === 2)?.action;
    expect(payAction).toBeDefined();
    if (!payAction || payAction.type !== 'pay_request') throw new Error('expected pay action');

    const reversed = {
      ...payAction,
      cards: [...payAction.cards].reverse(),
    };
    expect(() => applyRoomAction(room, playerTwo.playerId, playerTwo.sessionToken, reversed)).not.toThrow();
  });
});
