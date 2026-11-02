import type { Action, GameState } from '../engine/types';

// Finished games, kept so they can be watched again. Each is an opening state and its moves,
// which rebuild the game exactly because the engine is deterministic.

const REPLAYS_KEY = 'monopolyDeal.replays.v1';
const ACTIVE_REPLAY_KEY = 'monopolyDeal.activeReplay.v1';
const MAX_REPLAYS = 5;

export interface GameReplayLog {
  initial: GameState;
  actions: Action[];
}

export interface StoredReplay extends GameReplayLog {
  id: string;
  endedAt: number;
  title: string;
}

export function loadReplays(): StoredReplay[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(REPLAYS_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is StoredReplay => (
      Boolean(entry) && Array.isArray(entry.actions) && Boolean(entry.initial?.players)
    )) : [];
  } catch {
    return [];
  }
}

/** Oldest replays make way when storage runs short. A lost replay never costs a game. */
export function saveReplay(replay: StoredReplay): void {
  let kept = [replay, ...loadReplays().filter((entry) => entry.id !== replay.id)].slice(0, MAX_REPLAYS);
  while (kept.length > 0) {
    try {
      localStorage.setItem(REPLAYS_KEY, JSON.stringify(kept));
      return;
    } catch {
      kept = kept.slice(0, -1);
    }
  }
}

export function saveActiveReplay(log: GameReplayLog | null): void {
  try {
    if (log) localStorage.setItem(ACTIVE_REPLAY_KEY, JSON.stringify(log));
    else localStorage.removeItem(ACTIVE_REPLAY_KEY);
  } catch {
    // The game goes on without a replay.
  }
}

/** The running game's log, if it belongs to this game. */
export function loadActiveReplay(game: GameState): GameReplayLog | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACTIVE_REPLAY_KEY) ?? 'null') as GameReplayLog | null;
    return parsed?.initial?.createdAt === game.createdAt ? parsed : null;
  } catch {
    return null;
  }
}
