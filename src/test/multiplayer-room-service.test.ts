import { describe, expect, it } from 'vitest';
import {
  applyRoomAction,
  createRoom,
  joinRoom,
  leaveRoom,
  markSeatTimedOutIfExpired,
  loadRoomCheckpoint,
  normalizeRoomForRuntime,
  pauseRoom,
  pruneInactiveRooms,
  reconnectRoom,
  resetTurnRoomActions,
  resolveReconnectWindowMs,
  rematchRoom,
  resumeRoom,
  sendRoomChat,
  sendRoomReaction,
  setRoomPreset,
  setRoomTyping,
  setRoomReady,
  roomView,
  saveRoomCheckpoint,
  startRoom,
  undoRoomAction,
  type MultiplayerRoom,
} from '../../apps/server/src/gameService.ts';
import { formatReconnectTrace } from './fixtures/reconnect-trace';

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

function withPauseOnDisconnectPolicy<T>(run: () => T): T {
  return run();
}

function readyAllPlayers(room: MultiplayerRoom): void {
  room.players.forEach((player) => {
    setRoomReady(room, player.id, player.sessionToken, true);
  });
}

function startReadyRoom(
  room: MultiplayerRoom,
  session: { playerId: string; sessionToken: string },
  seed?: number,
  expectedRevision?: number,
  checkpointId?: string,
) {
  readyAllPlayers(room);
  return startRoom(room, session.playerId, session.sessionToken, seed, expectedRevision, checkpointId);
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

  it('returns canonical and legacy seat credentials for create/join/reconnect responses', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    expect(session.seatId).toBe(session.playerId);
    expect(session.resumeToken).toBe(session.sessionToken);

    const joined = joinRoom(room, 'Player 2');
    expect(joined.seatId).toBe(joined.playerId);
    expect(joined.resumeToken).toBe(joined.sessionToken);

    const resumed = reconnectRoom(room, joined.playerId, joined.sessionToken);
    expect(resumed.seatId).toBe(resumed.playerId);
    expect(resumed.resumeToken).toBe(resumed.sessionToken);
  });

  it('rejects stale expected revision during reconnect without mutating seat state', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    const joined = joinRoom(room, 'Player 2');
    startReadyRoom(room, session);
    leaveRoom(room, joined.playerId, joined.sessionToken);

    const revisionBefore = room.revision;
    expect(() => reconnectRoom(room, joined.playerId, joined.sessionToken, room.revision - 5)).toThrowError('revision_conflict');
    const participant = findParticipant(room, joined.playerId);
    expect(participant.connected).toBe(false);
    expect(participant.connectionState).toBe('disconnected');
    expect(room.revision).toBe(revisionBefore);
  });

  it('uses 90s reconnect grace default and respects configured override', () => {
    expect(resolveReconnectWindowMs(undefined)).toBe(90_000);
    expect(resolveReconnectWindowMs('120000')).toBe(120_000);
    expect(resolveReconnectWindowMs('invalid')).toBe(90_000);
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

  it('reclaims disconnected lobby seats even when reconnect grace has not expired', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room } = createRoom(rooms, 'Host');
    const [playerTwo] = fillLobby(room);
    const disconnected = findParticipant(room, playerTwo.playerId);
    disconnected.connected = false;
    disconnected.reconnectDeadlineMs = Date.now() + 60_000;

    const replacement = joinRoom(room, 'Replacement');
    expect(replacement.playerId).toBe(playerTwo.playerId);
    expect(room.players).toHaveLength(4);
  });

  it('removes lobby participants immediately when they leave', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');

    leaveRoom(room, playerTwo.playerId, playerTwo.sessionToken);

    expect(room.players.some((entry) => entry.id === playerTwo.playerId)).toBe(false);
    expect(room.players).toHaveLength(1);
  });

  it('allows repeated lobby leave and rejoin cycles without false room_full', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room } = createRoom(rooms, 'Host');

    for (let index = 0; index < 12; index += 1) {
      const guest = joinRoom(room, `Guest ${index}`);
      leaveRoom(room, guest.playerId, guest.sessionToken);
      expect(room.players.filter((entry) => entry.id !== 'p1')).toHaveLength(0);
    }

    expect(() => joinRoom(room, 'A')).not.toThrow();
    expect(() => joinRoom(room, 'B')).not.toThrow();
    expect(() => joinRoom(room, 'C')).not.toThrow();
    expect(() => joinRoom(room, 'Overflow')).toThrowError('room_full');
  });

  it('reclaims disconnected legacy lobby entries before room-full checks', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room } = createRoom(rooms, 'Host');
    const [playerTwo, playerThree] = fillLobby(room);
    findParticipant(room, playerTwo.playerId).connected = false;
    findParticipant(room, playerThree.playerId).connected = false;

    expect(() => joinRoom(room, 'Replacement 1')).not.toThrow();
    expect(() => joinRoom(room, 'Replacement 2')).not.toThrow();
    expect(room.players).toHaveLength(4);
    expect(room.players.every((entry) => entry.connected)).toBe(true);
  });

  it('removes stale lobby heartbeat participants instead of reserving disconnected seats', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');
    const staleNow = Date.now();
    const staleParticipant = findParticipant(room, playerTwo.playerId);
    staleParticipant.lastSeenAt = staleNow - 91_000;

    pruneInactiveRooms(rooms, staleNow);

    expect(room.players.some((entry) => entry.id === playerTwo.playerId)).toBe(false);
    expect(() => joinRoom(room, 'Replacement')).not.toThrow();
  });

  it('keeps active-match disconnect seats reserved and allows explicit reconnect', () => {
    withPauseOnDisconnectPolicy(() => {
      const rooms = new Map<string, MultiplayerRoom>();
      const { room, session } = createRoom(rooms, 'Host');
      const playerTwo = joinRoom(room, 'Player 2');
      startReadyRoom(room, session);

      leaveRoom(room, playerTwo.playerId, playerTwo.sessionToken);
      const disconnected = findParticipant(room, playerTwo.playerId);
      expect(disconnected.connected).toBe(false);
      expect(disconnected.connectionState).toBe('disconnected');
      expect(disconnected.disconnectedAt).not.toBeNull();
      expect(room.players.some((entry) => entry.id === playerTwo.playerId)).toBe(true);
      expect(room.roomRuntimeState).toBe('paused_disconnect');
      expect(room.pausedReason).toBe('player_disconnect');
      expect(room.paused).toBe(true);

      reconnectRoom(room, playerTwo.playerId, playerTwo.sessionToken);
      const reconnected = findParticipant(room, playerTwo.playerId);
      expect(reconnected.connected).toBe(true);
      expect(reconnected.connectionState).toBe('connected');
      expect(reconnected.disconnectedAt).toBeNull();
      expect(room.roomRuntimeState).toBe('active');
      expect(room.paused).toBe(false);
    });
  });

  it('restores disconnected seat during opponent turn without changing active actor', () => {
    withPauseOnDisconnectPolicy(() => {
      const rooms = new Map<string, MultiplayerRoom>();
      const { room, session } = createRoom(rooms, 'Host');
      const playerTwo = joinRoom(room, 'Player 2');
      startReadyRoom(room, session);
      if (!room.game) throw new Error('expected active game');
      room.game.currentPlayerIndex = 0;
      room.game.turn.phase = 'action';
      room.game.pending = null;

      leaveRoom(room, playerTwo.playerId, playerTwo.sessionToken);
      reconnectRoom(room, playerTwo.playerId, playerTwo.sessionToken);
      const resumedView = roomView(room, playerTwo.playerId, playerTwo.sessionToken);

      expect(resumedView.promptPlayerId).toBe(session.playerId);
      expect(resumedView.yourPlayerId).toBe(playerTwo.playerId);
      expect(room.roomRuntimeState).toBe('active');
      expect(room.paused).toBe(false);
    });
  });

  it('restores payment prompt context after reconnect during pending payment flow', () => {
    withPauseOnDisconnectPolicy(() => {
      const rooms = new Map<string, MultiplayerRoom>();
      const { room, session } = createRoom(rooms, 'Host');
      const playerTwo = joinRoom(room, 'Player 2');
      startReadyRoom(room, session);
      if (!room.game) throw new Error('expected active game');

      room.game.currentPlayerIndex = 0;
      room.game.turn.phase = 'action';
      room.game.turn.playsUsed = 1;
      room.game.pending = {
        kind: 'payment',
        payload: {
          sourcePlayerId: session.playerId,
          targetPlayerId: playerTwo.playerId,
          amount: 3,
          reason: 'rent',
          actionCardId: 'rent_color#r1',
        },
      };
      const payer = room.game.players.find((player) => player.id === playerTwo.playerId);
      if (!payer) throw new Error('expected payer');
      payer.bank = ['money_1#pay1', 'money_2#pay2'];

      leaveRoom(room, playerTwo.playerId, playerTwo.sessionToken);
      reconnectRoom(room, playerTwo.playerId, playerTwo.sessionToken);
      const resumedView = roomView(room, playerTwo.playerId, playerTwo.sessionToken);
      if (!resumedView.gameState) throw new Error('expected resumed game state');

      expect(resumedView.gameState.pending?.kind).toBe('payment');
      expect(resumedView.promptPlayerId).toBe(playerTwo.playerId);
      expect(resumedView.legalActions.some((entry) => entry.action.type === 'pay_request')).toBe(true);
    });
  });

  it('restores discard prompt context after reconnect during discard-to-limit flow', () => {
    withPauseOnDisconnectPolicy(() => {
      const rooms = new Map<string, MultiplayerRoom>();
      const { room, session } = createRoom(rooms, 'Host');
      joinRoom(room, 'Player 2');
      startReadyRoom(room, session);
      if (!room.game) throw new Error('expected active game');

      room.game.currentPlayerIndex = 0;
      room.game.turn.phase = 'action';
      room.game.turn.endingTurn = true;
      room.game.turn.playsUsed = 3;
      room.game.pending = null;
      const hostPlayer = room.game.players.find((player) => player.id === session.playerId);
      if (!hostPlayer) throw new Error('expected host');
      hostPlayer.hand = [
        'money_1#d1',
        'money_1#d2',
        'money_2#d3',
        'money_3#d4',
        'pass_go#d5',
        'rent_color#d6',
        'debt_collector#d7',
        'house#d8',
      ];

      leaveRoom(room, session.playerId, session.sessionToken);
      reconnectRoom(room, session.playerId, session.sessionToken);
      const resumedView = roomView(room, session.playerId, session.sessionToken);
      if (!resumedView.gameState) throw new Error('expected resumed game state');

      expect(resumedView.gameState.pending).toBeNull();
      expect(resumedView.promptPlayerId).toBe(session.playerId);
      const resumedHost = resumedView.gameState.players.find((player) => player.id === session.playerId);
      expect(resumedHost?.hand.length ?? 0).toBeGreaterThan(7);
      expect(resumedView.legalActions.some((entry) => entry.action.type === 'discard_card')).toBe(true);
    });
  });

  it('pauses room on host disconnect and ends room when host times out', () => {
    withPauseOnDisconnectPolicy(() => {
      const rooms = new Map<string, MultiplayerRoom>();
      const { room, session } = createRoom(rooms, 'Host');
      joinRoom(room, 'Player 2');
      startReadyRoom(room, session);

      leaveRoom(room, session.playerId, session.sessionToken);
      if (room.roomRuntimeState !== 'paused_host_disconnect') {
        throw new Error(formatReconnectTrace({
          roomCode: room.code,
          seatId: session.playerId,
          revision: room.revision,
          eventSequence: ['start', 'host_disconnect'],
          stateSequence: [room.roomRuntimeState ?? 'none', room.pausedReason ?? 'none'],
        }));
      }
      expect(room.roomRuntimeState).toBe('paused_host_disconnect');
      expect(room.pausedReason).toBe('host_disconnect');
      expect(room.paused).toBe(true);
      expect(room.hostPlayerId).toBe(session.playerId);

      const host = findParticipant(room, session.playerId);
      host.reconnectDeadlineMs = Date.now() - 1;
      const timeoutResult = markSeatTimedOutIfExpired(room, session.playerId, Date.now());
      expect(timeoutResult.transitioned).toBe(true);
      expect(room.roomRuntimeState).toBe('ended_timeout');
      expect(room.endedReason).toBe('host_timeout');
      expect(room.paused).toBe(false);
    });
  });

  it('resumes host-disconnect pause when host reconnects before timeout', () => {
    withPauseOnDisconnectPolicy(() => {
      const rooms = new Map<string, MultiplayerRoom>();
      const { room, session } = createRoom(rooms, 'Host');
      joinRoom(room, 'Player 2');
      startReadyRoom(room, session);

      leaveRoom(room, session.playerId, session.sessionToken);
      expect(room.roomRuntimeState).toBe('paused_host_disconnect');

      reconnectRoom(room, session.playerId, session.sessionToken);
      expect(room.roomRuntimeState).toBe('active');
      expect(room.pausedReason).toBeUndefined();
      expect(room.paused).toBe(false);
    });
  });

  it('restores manual host pause after a disconnected player reconnects', () => {
    withPauseOnDisconnectPolicy(() => {
      const rooms = new Map<string, MultiplayerRoom>();
      const { room, session } = createRoom(rooms, 'Host');
      const playerTwo = joinRoom(room, 'Player 2');
      startReadyRoom(room, session);

      pauseRoom(room, session.playerId, session.sessionToken);
      leaveRoom(room, playerTwo.playerId, playerTwo.sessionToken);
      reconnectRoom(room, playerTwo.playerId, playerTwo.sessionToken);

      expect(room.roomRuntimeState).toBe('active');
      expect(room.paused).toBe(true);
      expect(room.pausedReason).toBe('manual');
      expect(room.pausedByPlayerId).toBe(session.playerId);
      expect(room.disconnectPauseRestore).toBeUndefined();
    });
  });

  it('restores manual host pause after a disconnected non-host seat times out', () => {
    withPauseOnDisconnectPolicy(() => {
      const rooms = new Map<string, MultiplayerRoom>();
      const { room, session } = createRoom(rooms, 'Host');
      const playerTwo = joinRoom(room, 'Player 2');
      startReadyRoom(room, session);

      pauseRoom(room, session.playerId, session.sessionToken);
      leaveRoom(room, playerTwo.playerId, playerTwo.sessionToken);

      const disconnected = findParticipant(room, playerTwo.playerId);
      disconnected.reconnectDeadlineMs = Date.now() - 1;
      const timeoutResult = markSeatTimedOutIfExpired(room, playerTwo.playerId, Date.now());

      expect(timeoutResult.transitioned).toBe(true);
      expect(room.roomRuntimeState).toBe('active');
      expect(room.paused).toBe(true);
      expect(room.pausedReason).toBe('manual');
      expect(room.pausedByPlayerId).toBe(session.playerId);
      expect(room.disconnectPauseRestore).toBeUndefined();
    });
  });

  it('rejects room state access after reconnect window expiration', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');
    startReadyRoom(room, session);
    leaveRoom(room, playerTwo.playerId, playerTwo.sessionToken);
    const disconnected = findParticipant(room, playerTwo.playerId);
    disconnected.reconnectDeadlineMs = Date.now() - 1;

    expect(() => roomView(room, playerTwo.playerId, playerTwo.sessionToken)).toThrowError('reconnect_expired');
    expect(disconnected.connected).toBe(false);
  });

  it('keeps disconnected players disconnected when they poll room state within reconnect grace window', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');
    startReadyRoom(room, session);
    leaveRoom(room, playerTwo.playerId, playerTwo.sessionToken);
    const disconnected = findParticipant(room, playerTwo.playerId);
    disconnected.reconnectDeadlineMs = Date.now() + 60_000;

    const view = roomView(room, playerTwo.playerId, playerTwo.sessionToken);

    expect(view.yourPlayerId).toBe(playerTwo.playerId);
    expect(disconnected.connected).toBe(false);
    const playerSummary = view.players.find((player) => player.id === playerTwo.playerId);
    expect(playerSummary?.connected).toBe(false);
    expect(playerSummary?.connectionState).toBe('disconnected');
  });

  it('marks a disconnected seat as timed out only after grace expiration', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');
    startReadyRoom(room, session);
    leaveRoom(room, playerTwo.playerId, playerTwo.sessionToken);

    const beforeDeadline = markSeatTimedOutIfExpired(room, playerTwo.playerId, Date.now());
    expect(beforeDeadline.transitioned).toBe(false);

    const participant = findParticipant(room, playerTwo.playerId);
    participant.reconnectDeadlineMs = Date.now() - 1;
    const afterDeadline = markSeatTimedOutIfExpired(room, playerTwo.playerId, Date.now());
    expect(afterDeadline.transitioned).toBe(true);
    expect(findParticipant(room, playerTwo.playerId).connectionState).toBe('timed_out');
  });

  it('enforces host-only pause and resume', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');
    startReadyRoom(room, session);

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
    startReadyRoom(room, session);

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
    startReadyRoom(room, session);

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
    startReadyRoom(room, session);
    const staleRevision = room.revision - 1;

    expect(() => pauseRoom(room, session.playerId, session.sessionToken, staleRevision)).toThrowError('revision_conflict');
  });

  it('rejects stale expected revision for applyRoomAction without mutating room state', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    joinRoom(room, 'Player 2');
    startReadyRoom(room, session);

    const currentView = roomView(room, session.playerId, session.sessionToken);
    const nextAction = currentView.legalActions.find((entry) => entry.action.type === 'draw_cards')?.action ?? currentView.legalActions[0]?.action;
    expect(nextAction).toBeDefined();
    if (!nextAction) throw new Error('missing legal action');

    const staleRevision = room.revision - 1;
    const revisionBefore = room.revision;
    const gameSnapshotBefore = JSON.stringify(room.game);

    expect(() => applyRoomAction(room, session.playerId, session.sessionToken, nextAction, staleRevision)).toThrowError('revision_conflict');
    expect(room.revision).toBe(revisionBefore);
    expect(JSON.stringify(room.game)).toBe(gameSnapshotBefore);
  });

  it('rejects stale clientStateVersion under always-on version guard', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    joinRoom(room, 'Player 2');
    startReadyRoom(room, session);

    const currentView = roomView(room, session.playerId, session.sessionToken);
    const nextAction = currentView.legalActions.find((entry) => entry.action.type === 'draw_cards')?.action ?? currentView.legalActions[0]?.action;
    expect(nextAction).toBeDefined();
    if (!nextAction) throw new Error('missing legal action');

    const revisionBefore = room.revision;
    const gameSnapshotBefore = JSON.stringify(room.game);
    expect(() => applyRoomAction(room, session.playerId, session.sessionToken, nextAction, undefined, {
      clientStateVersion: room.revision - 1,
      actionId: 'stale-action-1',
    })).toThrowError('stale_state');
    expect(room.revision).toBe(revisionBefore);
    expect(JSON.stringify(room.game)).toBe(gameSnapshotBefore);
  });

  it('dedupes repeated actionId submissions so duplicate retries do not double-apply', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    joinRoom(room, 'Player 2');
    startReadyRoom(room, session);

    const currentView = roomView(room, session.playerId, session.sessionToken);
    const nextAction = currentView.legalActions.find((entry) => entry.action.type === 'draw_cards')?.action ?? currentView.legalActions[0]?.action;
    expect(nextAction).toBeDefined();
    if (!nextAction) throw new Error('missing legal action');

    applyRoomAction(room, session.playerId, session.sessionToken, nextAction, undefined, {
      clientStateVersion: room.revision,
      actionId: 'dedupe-action-1',
    });
    const revisionAfterFirst = room.revision;
    const gameSnapshotAfterFirst = JSON.stringify(room.game);

    expect(() => applyRoomAction(room, session.playerId, session.sessionToken, nextAction, undefined, {
      clientStateVersion: 0,
      actionId: 'dedupe-action-1',
    })).not.toThrow();
    expect(room.revision).toBe(revisionAfterFirst);
    expect(JSON.stringify(room.game)).toBe(gameSnapshotAfterFirst);
  });

  it('does not migrate host seat after match start when host disconnects', () => {
    withPauseOnDisconnectPolicy(() => {
      const rooms = new Map<string, MultiplayerRoom>();
      const { room, session } = createRoom(rooms, 'Host');
      const playerTwo = joinRoom(room, 'Player 2');
      startReadyRoom(room, session);

      leaveRoom(room, session.playerId, session.sessionToken);
      expect(room.hostPlayerId).toBe(session.playerId);

      reconnectRoom(room, session.playerId, session.sessionToken);
      expect(room.hostPlayerId).toBe(session.playerId);
      expect(room.hostPlayerId).not.toBe(playerTwo.playerId);
    });
  });

  it('updates player ready state in lobby and exposes it in room view', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');

    setRoomReady(room, playerTwo.playerId, playerTwo.sessionToken, true);

    const view = roomView(room, session.playerId, session.sessionToken);
    const readyPlayer = view.players.find((player) => player.id === playerTwo.playerId);
    expect(readyPlayer?.ready).toBe(true);
    expect(view.activityFeed.some((entry) => /is ready/i.test(entry.message))).toBe(true);
  });

  it('defaults rooms to the standard preset and only enables canStart once everyone is ready', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');

    expect(room.presetId).toBe('standard');
    expect(roomView(room, session.playerId, session.sessionToken).canStart).toBe(false);

    setRoomReady(room, session.playerId, session.sessionToken, true);
    expect(roomView(room, session.playerId, session.sessionToken).canStart).toBe(false);

    setRoomReady(room, playerTwo.playerId, playerTwo.sessionToken, true);
    const view = roomView(room, session.playerId, session.sessionToken);
    expect(view.presetId).toBe('standard');
    expect(view.canStart).toBe(true);
  });

  it('changes the room preset and clears ready state for the whole lobby', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');

    setRoomReady(room, session.playerId, session.sessionToken, true);
    setRoomReady(room, playerTwo.playerId, playerTwo.sessionToken, true);
    setRoomPreset(room, session.playerId, session.sessionToken, 'fast');

    const view = roomView(room, session.playerId, session.sessionToken);
    expect(view.presetId).toBe('fast');
    expect(view.canStart).toBe(false);
    expect(view.players.every((player) => !player.ready)).toBe(true);
  });

  it('records reactions and enforces reaction cooldown', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    joinRoom(room, 'Player 2');
    startReadyRoom(room, session);

    sendRoomReaction(room, session.playerId, session.sessionToken, 'gg');
    expect(room.activityFeed[0]?.kind).toBe('reaction');
    expect(room.activityFeed[0]?.reaction).toBe('gg');

    expect(() => sendRoomReaction(room, session.playerId, session.sessionToken, 'wow')).toThrowError('reaction_rate_limited');
  });

  it('starts a rematch with the selected preset and clears finished-room state', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');

    setRoomPreset(room, session.playerId, session.sessionToken, 'fast');
    startReadyRoom(room, session);

    room.game!.winnerId = 'p1';
    room.status = 'finished';
    room.players.forEach((player) => {
      player.ready = true;
    });
    room.turnSnapshots = [structuredClone(room.game!)];
    room.recentActionIds = ['dup-1'];
    room.paused = true;
    room.pausedReason = 'manual';

    rematchRoom(room, session.playerId, session.sessionToken);

    expect(room.status).toBe('active');
    expect(room.game?.winnerId).toBeUndefined();
    expect(room.game?.ruleset?.winCompleteSets).toBe(2);
    expect(room.turnSnapshots).toHaveLength(0);
    expect(room.recentActionIds).toHaveLength(0);
    expect(room.players.every((player) => !player.ready)).toBe(true);
    expect(roomView(room, session.playerId, session.sessionToken).canRematch).toBe(false);
    expect(findParticipant(room, playerTwo.playerId).connected).toBe(true);
  });

  it('stores chat messages and returns them in room view', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    joinRoom(room, 'Player 2');

    sendRoomChat(room, session.playerId, session.sessionToken, 'Hello table');

    const view = roomView(room, session.playerId, session.sessionToken);
    expect(view.chatMessages).toHaveLength(1);
    expect(view.chatMessages[0]?.text).toBe('Hello table');
    expect(view.chatMessages[0]?.playerId).toBe(session.playerId);
  });

  it('enforces chat rate limits and max message length', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    joinRoom(room, 'Player 2');

    sendRoomChat(room, session.playerId, session.sessionToken, 'first');
    expect(() => sendRoomChat(room, session.playerId, session.sessionToken, 'second')).toThrowError('chat_rate_limited');
    expect(() => sendRoomChat(room, session.playerId, session.sessionToken, 'x'.repeat(281))).toThrowError('chat_too_long');
  });

  it('tracks typing players and expires stale typing indicators', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    joinRoom(room, 'Player 2');

    setRoomTyping(room, session.playerId, session.sessionToken, true);
    let view = roomView(room, session.playerId, session.sessionToken);
    expect(view.typingPlayerIds).toContain(session.playerId);

    room.typingByPlayerId[session.playerId] = Date.now() - 1;
    view = roomView(room, session.playerId, session.sessionToken);
    expect(view.typingPlayerIds).not.toContain(session.playerId);
  });

  it('normalizes legacy rooms that are missing chat and typing fields', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room } = createRoom(rooms, 'Host');
    const legacy = {
      ...structuredClone(room),
      chatMessages: undefined,
      nextChatId: undefined,
      typingByPlayerId: undefined,
      players: room.players.map((player) => ({ ...player, lastChatAt: undefined })),
    } as unknown as MultiplayerRoom;

    const normalized = normalizeRoomForRuntime(legacy);
    expect(normalized.chatMessages).toEqual([]);
    expect(normalized.nextChatId).toBe(1);
    expect(normalized.typingByPlayerId).toEqual({});
    expect(normalized.players.every((player) => Number.isFinite(player.lastChatAt))).toBe(true);
  });

  it('normalizes persisted disconnect pause restore state', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room } = createRoom(rooms, 'Host');
    const legacy = {
      ...structuredClone(room),
      disconnectPauseRestore: {
        paused: true,
        pausedByPlayerId: 'p1',
      },
    } as MultiplayerRoom;

    const normalized = normalizeRoomForRuntime(legacy);
    expect(normalized.disconnectPauseRestore).toEqual({
      paused: true,
      pausedByPlayerId: 'p1',
    });
  });

  it('starts a lobby match from a compatible checkpoint when requested', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');
    startReadyRoom(room, session);
    const checkpoint = saveRoomCheckpoint(room, session.playerId, session.sessionToken, 'Resume');
    const checkpointGame = structuredClone(room.checkpoints[room.checkpoints.length - 1].game);

    // Simulate a persisted lobby resume scenario with checkpoints retained.
    room.game = null;
    room.status = 'lobby';

    const resumedRoom = startReadyRoom(room, session, undefined, undefined, checkpoint.id);
    const resumedGame = resumedRoom.game;
    if (!resumedGame) throw new Error('expected resumed game');
    expect(resumedGame.players.map((player) => player.id)).toEqual(checkpointGame.players.map((player) => player.id));
    expect(room.hostPlayerId).toBe(session.playerId);
    expect(room.players.some((entry) => entry.id === playerTwo.playerId)).toBe(true);
  });

  it('rejects checkpoint start when checkpoint players do not match lobby players', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    joinRoom(room, 'Player 2');
    startReadyRoom(room, session);
    const checkpoint = saveRoomCheckpoint(room, session.playerId, session.sessionToken, 'Resume');

    room.game = null;
    room.status = 'lobby';
    room.players = room.players.filter((entry) => entry.id !== 'p2');
    joinRoom(room, 'Replacement');

    readyAllPlayers(room);
    expect(() => startRoom(room, session.playerId, session.sessionToken, undefined, undefined, checkpoint.id)).toThrowError(
      'checkpoint_player_mismatch',
    );
  });

  it('rejects checkpoint start when checkpoint rules do not match the selected preset', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    joinRoom(room, 'Player 2');
    startReadyRoom(room, session);
    const checkpoint = saveRoomCheckpoint(room, session.playerId, session.sessionToken, 'Resume');

    room.game = null;
    room.status = 'lobby';
    room.roomRuntimeState = undefined;

    setRoomPreset(room, session.playerId, session.sessionToken, 'fast');
    readyAllPlayers(room);

    expect(() => startRoom(room, session.playerId, session.sessionToken, undefined, undefined, checkpoint.id)).toThrowError(
      'checkpoint_preset_mismatch',
    );
  });

  it('rejects stale expected revision on leave without disconnecting the seat', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');
    startReadyRoom(room, session);
    const staleRevision = room.revision - 1;

    expect(() => leaveRoom(room, playerTwo.playerId, playerTwo.sessionToken, staleRevision)).toThrowError('revision_conflict');

    const participant = findParticipant(room, playerTwo.playerId);
    expect(participant.connected).toBe(true);
  });

  it('accepts manual pay_request card order when cards are otherwise legal', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');
    startReadyRoom(room, session);

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

  it('accepts valid manual pay_request combinations beyond generated legal options', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');
    startReadyRoom(room, session);

    if (!room.game) throw new Error('expected game');
    const payer = room.game.players.find((player) => player.id === playerTwo.playerId);
    if (!payer) throw new Error('expected payer');
    payer.bank = ['money_1#pay1', 'money_2#pay2', 'money_3#pay3'];
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
    const allCards = ['money_1#pay1', 'money_2#pay2', 'money_3#pay3'];
    const hasAllCardsOption = legal.some((entry) => (
      entry.action.type === 'pay_request'
      && entry.action.cards.length === allCards.length
      && entry.action.cards.every((cardId, index) => cardId === allCards[index])
    ));
    expect(hasAllCardsOption).toBe(false);

    expect(() => applyRoomAction(room, playerTwo.playerId, playerTwo.sessionToken, {
      type: 'pay_request',
      playerId: playerTwo.playerId,
      cards: allCards,
    })).not.toThrow();
  });
});
