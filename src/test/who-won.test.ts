import { describe, expect, it } from 'vitest';
import { createGame, type GameState } from '../engine';
import { applyMatchToAchievementState, applyMatchToDailyChallenge, buildMatchRecord, defaultAchievementState, ensureTodayDailyChallenge } from '../stats';

function finished(winnerId: string): GameState {
  const state = createGame({
    seed: 1,
    players: [
      { id: 'p1', name: 'Ann', controller: 'human' },
      { id: 'p2', name: 'Bot', controller: 'bot', botDifficulty: 'easy' },
    ],
  });
  state.winnerId = winnerId;
  state.turnCount = 5;
  return state;
}

const achievements = () => defaultAchievementState();

describe('what counts as your win', () => {
  it('counts a person beating a bot on this device', () => {
    const record = buildMatchRecord(finished('p1'), { mode: 'practice', surface: 'local' });
    const next = applyMatchToAchievementState(achievements(), record);
    expect(next.counters.wins).toBe(1);
    expect(next.counters.quickWins).toBe(1);
    expect(next.unlockedAt.first_win).toBeDefined();
  });

  it("doesn't count a bot beating you", () => {
    const record = buildMatchRecord(finished('p2'), { mode: 'practice', surface: 'local' });
    const next = applyMatchToAchievementState(achievements(), record);
    expect(next.counters.wins).toBe(0);
    expect(next.counters.quickWins).toBe(0);
    expect(next.unlockedAt.first_win).toBeUndefined();
  });

  it('counts any person winning a pass-and-play game', () => {
    const state = finished('p2');
    state.players[1].controller = 'human';
    expect(applyMatchToAchievementState(achievements(), buildMatchRecord(state, { mode: 'hot_seat', surface: 'local' })).counters.wins).toBe(1);
  });

  it('online, counts only this seat winning', () => {
    const state = finished('p1');
    const mine = buildMatchRecord(state, { mode: 'live_online', surface: 'multiplayer', viewerId: 'p1' });
    const theirs = buildMatchRecord(state, { mode: 'live_online', surface: 'multiplayer', viewerId: 'p2' });
    expect(applyMatchToAchievementState(achievements(), mine).counters.wins).toBe(1);
    expect(applyMatchToAchievementState(achievements(), theirs).counters.wins).toBe(0);
  });

  it('still reads records saved before this was tracked', () => {
    const record = buildMatchRecord(finished('p1'), { mode: 'practice', surface: 'local' });
    delete record.viewerWon;
    expect(applyMatchToAchievementState(achievements(), record).counters.wins).toBe(1);
  });

  it("doesn't complete the daily challenge on a loss", () => {
    const daily = ensureTodayDailyChallenge(null);
    const lost = buildMatchRecord(finished('p2'), { mode: 'daily_challenge', surface: 'local' });
    const won = buildMatchRecord(finished('p1'), { mode: 'daily_challenge', surface: 'local' });
    expect(applyMatchToDailyChallenge(daily, lost).completed).toBe(false);
    expect(applyMatchToDailyChallenge(daily, won).completed).toBe(true);
  });
});
