import type { AchievementId, AchievementStateV1, DailyChallengeV1, MatchRecordV1 } from './types';

const ACHIEVEMENT_TARGETS: Record<AchievementId, number> = {
  first_win: 1,
  ten_wins: 10,
  action_century: 100,
  quick_win: 1,
};

const ACHIEVEMENT_LABELS: Record<AchievementId, string> = {
  first_win: 'First Win',
  ten_wins: 'Ten Wins',
  action_century: 'Action Century',
  quick_win: 'Quick Win',
};

function sumActions(match: MatchRecordV1): number {
  return Object.values(match.actionsByType).reduce((sum, count) => sum + count, 0);
}

function todayDay(now = Date.now()): string {
  const date = new Date(now);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function seedFromDay(day: string): number {
  let value = 0;
  for (const char of day) {
    value = (value * 31 + char.charCodeAt(0)) % 1_000_000_007;
  }
  return value;
}

function targetTurnsFromSeed(seed: number): number {
  return 12 + (seed % 4);
}

export function defaultAchievementState(): AchievementStateV1 {
  return {
    version: 1,
    counters: {
      wins: 0,
      actions: 0,
      gamesPlayed: 0,
      quickWins: 0,
    },
    unlockedAt: {},
  };
}

export function defaultDailyChallenge(day = todayDay()): DailyChallengeV1 {
  const seed = seedFromDay(day);
  return {
    version: 1,
    day,
    seed,
    targetTurns: targetTurnsFromSeed(seed),
    completed: false,
    attempts: 0,
    bestTurnCount: null,
  };
}

export function ensureTodayDailyChallenge(current: DailyChallengeV1 | null | undefined, now = Date.now()): DailyChallengeV1 {
  const day = todayDay(now);
  if (!current || current.version !== 1 || current.day !== day) {
    return defaultDailyChallenge(day);
  }
  return current;
}

function markUnlocked(next: AchievementStateV1, id: AchievementId, timestamp: number): void {
  if (!next.unlockedAt[id]) {
    next.unlockedAt[id] = timestamp;
  }
}

export function applyMatchToAchievementState(current: AchievementStateV1, match: MatchRecordV1): AchievementStateV1 {
  const next = structuredClone(current);

  next.counters.gamesPlayed += 1;
  next.counters.actions += sumActions(match);
  if (match.winnerName) next.counters.wins += 1;
  if (match.turnCount <= 12 && match.winnerName) next.counters.quickWins += 1;

  if (next.counters.wins >= ACHIEVEMENT_TARGETS.first_win) markUnlocked(next, 'first_win', match.endedAt);
  if (next.counters.wins >= ACHIEVEMENT_TARGETS.ten_wins) markUnlocked(next, 'ten_wins', match.endedAt);
  if (next.counters.actions >= ACHIEVEMENT_TARGETS.action_century) markUnlocked(next, 'action_century', match.endedAt);
  if (next.counters.quickWins >= ACHIEVEMENT_TARGETS.quick_win) markUnlocked(next, 'quick_win', match.endedAt);

  return next;
}

export function applyMatchToDailyChallenge(current: DailyChallengeV1, match: MatchRecordV1): DailyChallengeV1 {
  const next = structuredClone(current);
  next.attempts += 1;
  if (next.bestTurnCount == null || match.turnCount < next.bestTurnCount) {
    next.bestTurnCount = match.turnCount;
  }
  if (match.turnCount <= next.targetTurns) {
    next.completed = true;
  }
  return next;
}

export function getUnlockedAchievementIds(state: AchievementStateV1): AchievementId[] {
  return (Object.keys(ACHIEVEMENT_TARGETS) as AchievementId[]).filter((id) => Boolean(state.unlockedAt[id]));
}

export function getNewAchievementUnlocks(previous: AchievementStateV1, next: AchievementStateV1): AchievementId[] {
  return (Object.keys(ACHIEVEMENT_TARGETS) as AchievementId[]).filter((id) => !previous.unlockedAt[id] && Boolean(next.unlockedAt[id]));
}

export function achievementLabel(id: AchievementId): string {
  return ACHIEVEMENT_LABELS[id];
}
