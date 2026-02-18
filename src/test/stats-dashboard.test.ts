import { describe, expect, it } from 'vitest';
import { buildLifetimeRows, buildMatchRows, buildStatsDashboardModel } from '../stats';
import { createStatsFixture } from './fixtures/statsFixtures';

describe('stats dashboard helpers', () => {
  it('builds lifetime rows with derived metrics and default ordering', () => {
    const fixture = createStatsFixture('medium');
    const rows = buildLifetimeRows(fixture.lifetime);

    expect(rows).toHaveLength(3);
    expect(rows[0].name).toBe('Alpha');
    expect(rows[0].winRate).toBeCloseTo(2 / 3);
    expect(rows[0].avgTurns).toBeCloseTo(52 / 3);
    expect(rows[0].totalActions).toBe(50);
  });

  it('builds match rows and sorts latest first', () => {
    const fixture = createStatsFixture('medium');
    const rows = buildMatchRows(fixture.history);

    expect(rows).toHaveLength(3);
    expect(rows[0].id).toBe('m-1');
    expect(rows[0].winnerName).toBe('Alpha');
    expect(rows[0].totalEvents).toBe(21);
  });

  it('builds dashboard series, kpis, and buckets', () => {
    const fixture = createStatsFixture('medium');
    const model = buildStatsDashboardModel(fixture.history, fixture.lifetime);

    expect(model.kpis.totalMatches).toBe(3);
    expect(model.kpis.topWinnerWins).toBe(2);
    expect(model.kpis.topWinnerName).toBe('Alpha');
    expect(model.kpis.topActionType).toBe('action');
    expect(model.winsByPlayer.map((entry) => entry.player)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(model.matchTrends).toHaveLength(3);
    expect(model.actionDistribution[0]).toEqual({ actionType: 'action', count: 26 });
    expect(model.turnBuckets.find((bucket) => bucket.bucket === '11-20')?.count).toBe(2);
  });

  it('handles empty and edge fixtures gracefully', () => {
    const empty = createStatsFixture('empty');
    const edge = createStatsFixture('edge');

    const emptyModel = buildStatsDashboardModel(empty.history, empty.lifetime);
    const edgeModel = buildStatsDashboardModel(edge.history, edge.lifetime);

    expect(emptyModel.kpis.totalMatches).toBe(0);
    expect(emptyModel.lifetimeRows).toHaveLength(0);
    expect(edgeModel.kpis.topWinnerName).toBe('N/A');
    expect(edgeModel.matchRows[0].winnerName).toBe('N/A');
  });

  it('applies player and winner filters consistently across dashboard outputs', () => {
    const fixture = createStatsFixture('medium');
    const model = buildStatsDashboardModel(fixture.history, fixture.lifetime, {
      playerName: 'Alpha',
      winnerName: 'Alpha',
    });

    expect(model.matchRows.every((row) => row.winnerName === 'Alpha')).toBe(true);
    expect(model.matchRows.every((row) => row.playersLabel.includes('Alpha'))).toBe(true);
    expect(model.kpis.totalMatches).toBe(model.matchRows.length);
    expect(model.matchTrends).toHaveLength(model.matchRows.length);
  });

  it('derives growth telemetry kpis and event series when metrics are provided', () => {
    const fixture = createStatsFixture('medium');
    const metrics = {
      version: 1 as const,
      events: {
        share_image_clicked: 4,
        share_image_success: 3,
        payment_auto_selected: 6,
        rules_drawer_opened: 8,
        game_started: 10,
        game_completed: 7,
        rematch_started: 2,
        lan_room_hosted: 1,
        lan_room_joined: 2,
        coach_hint_viewed: 5,
        multiplayer_host_started: 1,
        multiplayer_join_success: 2,
        multiplayer_join_failed: 1,
        multiplayer_invite_copied: 3,
        multiplayer_deep_link_opened: 2,
        multiplayer_reconnect_success: 2,
        multiplayer_reconnect_failed: 1,
        multiplayer_match_completed: 1,
        multiplayer_push_connected: 3,
        multiplayer_push_disconnected: 1,
        multiplayer_push_fallback: 1,
        multiplayer_rate_limited: 2,
        multiplayer_origin_blocked: 1,
      },
    };
    const model = buildStatsDashboardModel(fixture.history, fixture.lifetime, undefined, metrics);

    expect(model.growthKpis.gameStarts).toBe(10);
    expect(model.growthKpis.gameCompletions).toBe(7);
    expect(model.growthKpis.completionRate).toBeCloseTo(0.7);
    expect(model.growthKpis.shareConversionRate).toBeCloseTo(0.75);
    expect(model.growthEvents.find((event) => event.event === 'Coach hints viewed')?.count).toBe(5);
  });
});
