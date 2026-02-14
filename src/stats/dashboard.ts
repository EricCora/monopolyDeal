import type { LifetimeStatsV1, MatchRecordV1 } from './types';

export interface LifetimeRowView {
  name: string;
  wins: number;
  gamesPlayed: number;
  winRate: number;
  avgTurns: number;
  avgDurationSec: number;
  totalActions: number;
  topActionType: string;
  topActionCount: number;
}

export interface MatchRowView {
  id: string;
  endedAt: number;
  winnerName: string;
  playersLabel: string;
  playersCount: number;
  turnCount: number;
  durationSec: number;
  totalEvents: number;
}

export interface StatsKpis {
  totalMatches: number;
  avgTurns: number;
  avgDurationSec: number;
  topWinnerName: string;
  topWinnerWins: number;
  topActionType: string;
  topActionCount: number;
}

export interface StatsDashboardModel {
  kpis: StatsKpis;
  lifetimeRows: LifetimeRowView[];
  matchRows: MatchRowView[];
  winsByPlayer: Array<{ player: string; wins: number }>;
  matchTrends: Array<{ label: string; endedAt: number; turns: number; durationSec: number }>;
  actionDistribution: Array<{ actionType: string; count: number }>;
  matchesByDay: Array<{ day: string; count: number }>;
  turnBuckets: Array<{ bucket: string; count: number }>;
}

export interface StatsFilters {
  playerName?: string;
  winnerName?: string;
  fromDay?: string;
  toDay?: string;
}

function sumActionsByType(actionsByType: Record<string, number>): number {
  return Object.values(actionsByType).reduce((sum, count) => sum + count, 0);
}

function topAction(actionsByType: Record<string, number>): { type: string; count: number } {
  let type = 'N/A';
  let count = 0;
  for (const [actionType, value] of Object.entries(actionsByType)) {
    if (value > count) {
      type = actionType;
      count = value;
    }
  }
  return { type, count };
}

function dayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function turnsBucket(turnCount: number): string {
  if (turnCount <= 10) return '0-10';
  if (turnCount <= 20) return '11-20';
  if (turnCount <= 30) return '21-30';
  if (turnCount <= 40) return '31-40';
  return '41+';
}

export function buildLifetimeRows(lifetime: LifetimeStatsV1): LifetimeRowView[] {
  return Object.values(lifetime.players)
    .map((player) => {
      const gamesPlayed = player.gamesPlayed;
      const totalActions = sumActionsByType(player.actionsByType);
      const bestAction = topAction(player.actionsByType);
      return {
        name: player.name,
        wins: player.wins,
        gamesPlayed,
        winRate: gamesPlayed > 0 ? player.wins / gamesPlayed : 0,
        avgTurns: gamesPlayed > 0 ? player.totalTurns / gamesPlayed : 0,
        avgDurationSec: gamesPlayed > 0 ? player.totalDurationSec / gamesPlayed : 0,
        totalActions,
        topActionType: bestAction.type,
        topActionCount: bestAction.count,
      };
    })
    .sort((left, right) => {
      if (right.wins !== left.wins) return right.wins - left.wins;
      if (right.winRate !== left.winRate) return right.winRate - left.winRate;
      return left.name.localeCompare(right.name);
    });
}

export function buildMatchRows(history: MatchRecordV1[]): MatchRowView[] {
  return history
    .map((match) => ({
      id: match.id,
      endedAt: match.endedAt,
      winnerName: match.winnerName ?? 'N/A',
      playersLabel: match.players.join(', '),
      playersCount: match.players.length,
      turnCount: match.turnCount,
      durationSec: match.durationSec,
      totalEvents: sumActionsByType(match.actionsByType),
    }))
    .sort((left, right) => right.endedAt - left.endedAt);
}

function applyStatsFilters(history: MatchRecordV1[], filters?: StatsFilters): MatchRecordV1[] {
  if (!filters) return history;
  return history.filter((match) => {
    if (filters.playerName && !match.players.includes(filters.playerName)) return false;
    if (filters.winnerName && match.winnerName !== filters.winnerName) return false;
    const day = dayLabel(match.endedAt);
    if (filters.fromDay && day < filters.fromDay) return false;
    if (filters.toDay && day > filters.toDay) return false;
    return true;
  });
}

export function buildStatsDashboardModel(history: MatchRecordV1[], lifetime: LifetimeStatsV1, filters?: StatsFilters): StatsDashboardModel {
  const filteredHistory = applyStatsFilters(history, filters);
  const lifetimeRows = buildLifetimeRows(lifetime).filter((row) => {
    if (filters?.playerName && row.name !== filters.playerName) return false;
    if (filters?.winnerName && row.name !== filters.winnerName) return false;
    return true;
  });
  const matchRows = buildMatchRows(filteredHistory);

  const turnsTotal = matchRows.reduce((sum, row) => sum + row.turnCount, 0);
  const durationTotal = matchRows.reduce((sum, row) => sum + row.durationSec, 0);

  const winnerCounts = new Map<string, number>();
  const actionCounts = new Map<string, number>();
  const byDay = new Map<string, number>();
  const turnBucketCounts = new Map<string, number>();

  for (const match of filteredHistory) {
    if (match.winnerName) winnerCounts.set(match.winnerName, (winnerCounts.get(match.winnerName) ?? 0) + 1);
    const day = dayLabel(match.endedAt);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    const bucket = turnsBucket(match.turnCount);
    turnBucketCounts.set(bucket, (turnBucketCounts.get(bucket) ?? 0) + 1);
    for (const [actionType, count] of Object.entries(match.actionsByType)) {
      actionCounts.set(actionType, (actionCounts.get(actionType) ?? 0) + count);
    }
  }

  const topWinner = Array.from(winnerCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  const topActionType = Array.from(actionCounts.entries()).sort((a, b) => b[1] - a[1])[0];

  const matchTrends = matchRows
    .slice()
    .sort((a, b) => a.endedAt - b.endedAt)
    .map((row, index) => ({
      label: `${index + 1}`,
      endedAt: row.endedAt,
      turns: row.turnCount,
      durationSec: row.durationSec,
    }));

  return {
    kpis: {
      totalMatches: filteredHistory.length,
      avgTurns: filteredHistory.length > 0 ? turnsTotal / filteredHistory.length : 0,
      avgDurationSec: filteredHistory.length > 0 ? durationTotal / filteredHistory.length : 0,
      topWinnerName: topWinner?.[0] ?? 'N/A',
      topWinnerWins: topWinner?.[1] ?? 0,
      topActionType: topActionType?.[0] ?? 'N/A',
      topActionCount: topActionType?.[1] ?? 0,
    },
    lifetimeRows,
    matchRows,
    winsByPlayer: lifetimeRows.map((row) => ({ player: row.name, wins: row.wins })),
    matchTrends,
    actionDistribution: Array.from(actionCounts.entries())
      .map(([actionType, count]) => ({ actionType, count }))
      .sort((a, b) => b.count - a.count),
    matchesByDay: Array.from(byDay.entries())
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    turnBuckets: ['0-10', '11-20', '21-30', '31-40', '41+'].map((bucket) => ({
      bucket,
      count: turnBucketCounts.get(bucket) ?? 0,
    })),
  };
}
