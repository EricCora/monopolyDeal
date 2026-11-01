/**
 * A browser-style player for the iOS cross-play test: it joins a room over HTTP, then
 * plays over Socket.IO, the same transport the web client uses first.
 *
 *   node --import tsx/esm scripts/online_peer.ts http://localhost:8787 ABCD
 *   node --import tsx/esm scripts/online_peer.ts http://localhost:8787 --host   hosts a room, prints its code, starts when ready
 */
import { io } from 'socket.io-client';
import { chooseHeuristicAction } from '../src/ai/heuristic';
import type { GameState, LegalAction } from '../src/engine';

const [baseUrl, roomArg] = process.argv.slice(2);
const hosting = roomArg === '--host';

interface View {
  revision: number;
  started: boolean;
  status: string;
  yourPlayerId: string;
  legalActions: LegalAction[];
  canStart: boolean;
  gameState?: GameState;
  players: Array<{ id: string; ready: boolean }>;
  winnerId?: string;
}

interface Ack<T> {
  ok: boolean;
  payload?: T;
  error?: { code: string; message?: string };
}

const joined = await fetch(hosting ? `${baseUrl}/api/multiplayer/rooms` : `${baseUrl}/api/multiplayer/rooms/${roomArg}/join`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ playerName: 'Browser Peer' }),
}).then((response) => response.json()) as { roomCode: string; seatId: string; resumeToken: string; playerId: string; sessionToken: string };
const roomCode = joined.roomCode;
if (hosting) console.log(`room=${roomCode}`);

const socket = io(baseUrl, {
  transports: ['websocket'],
  auth: { roomCode, seatId: joined.seatId, resumeToken: joined.resumeToken, playerId: joined.playerId, sessionToken: joined.sessionToken },
});

function command<T>(name: string, payload: object): Promise<Ack<T>> {
  return new Promise((resolve) => socket.emit(name, payload, resolve));
}

let busy = false;
let again = false;
let readySent = false;
let acted = 0;

async function step(): Promise<void> {
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  try {
    do {
      again = false;
      const state = await command<View>('mp:cmd:state', {});
      const view = state.payload;
      if (!view) continue;
      if (view.status === 'finished') {
        console.log(`finished winner=${view.winnerId ?? 'none'} actions=${acted}`);
        socket.disconnect();
        process.exit(0);
      }
      if (!view.started) {
        const you = view.players.find((player) => player.id === view.yourPlayerId);
        if (!readySent && you && !you.ready) {
          readySent = true;
          await command('mp:cmd:ready', { ready: true, expectedRevision: view.revision });
        }
        if (hosting && view.canStart) await command('mp:cmd:start', { expectedRevision: view.revision });
        continue;
      }
      if (view.legalActions.length > 0 && view.gameState) {
        const choice = chooseHeuristicAction(view.gameState, view.yourPlayerId, view.legalActions)?.action ?? view.legalActions[0].action;
        const result = await command('mp:cmd:action', { action: choice, expectedRevision: view.revision });
        if (result.ok) acted += 1;
        again = true;
      }
    } while (again);
  } finally {
    busy = false;
  }
}

socket.on('connect', () => void step());
socket.on('room_update', () => void step());
socket.on('connect_error', (error) => {
  console.error(`connect_error ${error.message}`);
  process.exit(1);
});
setInterval(() => void step(), 1000);
setTimeout(() => {
  console.error('peer timed out');
  process.exit(1);
}, 280_000);
