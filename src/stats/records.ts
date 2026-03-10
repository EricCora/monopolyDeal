import type { GameState } from '../engine';
import type { LifetimePlayerStats, LifetimeStatsV1, MatchRecordV1, MatchSurface } from './types';
import type { MatchMode, MultiplayerSessionPresetId } from '../ui/experience';

interface MatchRecordMetadata {
  mode: MatchMode;
  surface: MatchSurface;
  presetId?: MultiplayerSessionPresetId;
  roomCode?: string;
}

export function buildMatchRecord(state: GameState, metadata: MatchRecordMetadata): MatchRecordV1 {
  const actionsByType: Record<string, number> = {};
  for (const event of state.history) {
    actionsByType[event.type] = (actionsByType[event.type] ?? 0) + 1;
  }

  const winner = state.players.find((player) => player.id === state.winnerId);

  return {
    id: `${state.createdAt}-${state.updatedAt}`,
    startedAt: state.createdAt,
    endedAt: state.updatedAt,
    players: state.players.map((player) => player.name),
    winnerId: state.winnerId,
    winnerName: winner?.name,
    turnCount: state.turnCount,
    durationSec: Math.max(1, Math.floor((state.updatedAt - state.createdAt) / 1000)),
    actionsByType,
    mode: metadata.mode,
    surface: metadata.surface,
    presetId: metadata.presetId,
    roomCode: metadata.roomCode,
  };
}

function ensurePlayer(stats: LifetimeStatsV1, name: string): LifetimePlayerStats {
  const existing = stats.players[name];
  if (existing) return existing;

  const created: LifetimePlayerStats = {
    name,
    gamesPlayed: 0,
    wins: 0,
    totalTurns: 0,
    totalDurationSec: 0,
    actionsByType: {},
  };
  stats.players[name] = created;
  return created;
}

export function applyMatchToLifetime(stats: LifetimeStatsV1, match: MatchRecordV1): LifetimeStatsV1 {
  const next = structuredClone(stats);

  for (const playerName of match.players) {
    const playerStats = ensurePlayer(next, playerName);
    playerStats.gamesPlayed += 1;
    playerStats.totalTurns += match.turnCount;
    playerStats.totalDurationSec += match.durationSec;
    for (const [eventType, count] of Object.entries(match.actionsByType)) {
      playerStats.actionsByType[eventType] = (playerStats.actionsByType[eventType] ?? 0) + count;
    }
  }

  if (match.winnerName) {
    ensurePlayer(next, match.winnerName).wins += 1;
  }

  return next;
}
