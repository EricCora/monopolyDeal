import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearGrowthMetrics,
  clearLifetimeStats,
  clearMatchHistory,
  deleteSavedGameSlot,
  incrementGrowthMetric,
  loadAchievementState,
  loadDailyChallenge,
  loadGrowthMetrics,
  loadSavedGameSlot,
  loadSavedGames,
  loadUiPreferences,
  renameSavedGameSlot,
  saveAchievementState,
  saveDailyChallenge,
  saveGrowthMetrics,
  saveUiPreferences,
  upsertSavedGameSlot,
} from '../persistence/storage';
import { createGame } from '../engine';

describe('growth metrics storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns default growth metrics when localStorage is missing or invalid', () => {
    expect(loadGrowthMetrics()).toEqual({
      version: 1,
      events: {
        share_image_clicked: 0,
        share_image_success: 0,
        payment_auto_selected: 0,
        rules_drawer_opened: 0,
        game_started: 0,
        game_completed: 0,
        rematch_started: 0,
        lan_room_hosted: 0,
        lan_room_joined: 0,
        coach_hint_viewed: 0,
        multiplayer_host_started: 0,
        multiplayer_join_success: 0,
        multiplayer_join_failed: 0,
        multiplayer_invite_copied: 0,
        multiplayer_deep_link_opened: 0,
        multiplayer_resume_attempt: 0,
        multiplayer_resume_success: 0,
        multiplayer_resume_failure: 0,
        multiplayer_resync_started: 0,
        multiplayer_resync_completed: 0,
        multiplayer_reconnect_success: 0,
        multiplayer_reconnect_failed: 0,
        multiplayer_match_completed: 0,
        multiplayer_push_connected: 0,
        multiplayer_push_disconnected: 0,
        multiplayer_push_fallback: 0,
      },
    });

    localStorage.setItem('monopolyDeal.growthMetrics.v1', '{not-json');
    expect(loadGrowthMetrics()).toEqual({
      version: 1,
      events: {
        share_image_clicked: 0,
        share_image_success: 0,
        payment_auto_selected: 0,
        rules_drawer_opened: 0,
        game_started: 0,
        game_completed: 0,
        rematch_started: 0,
        lan_room_hosted: 0,
        lan_room_joined: 0,
        coach_hint_viewed: 0,
        multiplayer_host_started: 0,
        multiplayer_join_success: 0,
        multiplayer_join_failed: 0,
        multiplayer_invite_copied: 0,
        multiplayer_deep_link_opened: 0,
        multiplayer_resume_attempt: 0,
        multiplayer_resume_success: 0,
        multiplayer_resume_failure: 0,
        multiplayer_resync_started: 0,
        multiplayer_resync_completed: 0,
        multiplayer_reconnect_success: 0,
        multiplayer_reconnect_failed: 0,
        multiplayer_match_completed: 0,
        multiplayer_push_connected: 0,
        multiplayer_push_disconnected: 0,
        multiplayer_push_fallback: 0,
      },
    });
  });

  it('saves and increments growth metrics event counters', () => {
    saveGrowthMetrics({
      version: 1,
      events: {
        share_image_clicked: 2,
        share_image_success: 1,
        payment_auto_selected: 0,
        rules_drawer_opened: 0,
        game_started: 0,
        game_completed: 0,
        rematch_started: 0,
        lan_room_hosted: 0,
        lan_room_joined: 0,
        coach_hint_viewed: 0,
        multiplayer_host_started: 0,
        multiplayer_join_success: 0,
        multiplayer_join_failed: 0,
        multiplayer_invite_copied: 0,
        multiplayer_deep_link_opened: 0,
        multiplayer_resume_attempt: 0,
        multiplayer_resume_success: 0,
        multiplayer_resume_failure: 0,
        multiplayer_resync_started: 0,
        multiplayer_resync_completed: 0,
        multiplayer_reconnect_success: 0,
        multiplayer_reconnect_failed: 0,
        multiplayer_match_completed: 0,
        multiplayer_push_connected: 0,
        multiplayer_push_disconnected: 0,
        multiplayer_push_fallback: 0,
      },
    });

    const next = incrementGrowthMetric('share_image_clicked');
    expect(next.events.share_image_clicked).toBe(3);
    expect(next.events.share_image_success).toBe(1);
    expect(loadGrowthMetrics()).toEqual(next);
  });

  it('sanitizes invalid growth metrics values before incrementing', () => {
    localStorage.setItem(
      'monopolyDeal.growthMetrics.v1',
      JSON.stringify({
        version: 1,
        events: {
          share_image_clicked: 'broken',
          share_image_success: null,
          payment_auto_selected: undefined,
          rules_drawer_opened: 'x',
          game_started: null,
          game_completed: 'bad',
          rematch_started: undefined,
          lan_room_hosted: {},
          lan_room_joined: [],
          coach_hint_viewed: 'oops',
          multiplayer_host_started: null,
          multiplayer_join_success: 'bad',
          multiplayer_join_failed: [],
          multiplayer_invite_copied: {},
          multiplayer_deep_link_opened: undefined,
          multiplayer_resume_attempt: null,
          multiplayer_resume_success: 'bad',
          multiplayer_resume_failure: {},
          multiplayer_resync_started: [],
          multiplayer_resync_completed: 'x',
          multiplayer_reconnect_success: 'x',
          multiplayer_reconnect_failed: {},
          multiplayer_match_completed: null,
          multiplayer_push_connected: {},
          multiplayer_push_disconnected: [],
          multiplayer_push_fallback: 'oops',
        },
      }),
    );

    const next = incrementGrowthMetric('share_image_clicked');
    expect(next.events.share_image_clicked).toBe(1);
    expect(next.events.share_image_success).toBe(0);
  });
});

describe('ui preferences storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('backfills new preference fields for legacy v1 payloads', () => {
    localStorage.setItem(
      'monopolyDeal.uiPreferences.v1',
      JSON.stringify({
        version: 1,
        reducedEffects: true,
        tableDensity: 'compact',
        textScale: 'large',
      }),
    );

    expect(loadUiPreferences()).toEqual({
      version: 1,
      reducedEffects: true,
      tableDensity: 'compact',
      tableStyle: 'classic_green',
      textScale: 'large',
      confirmRiskyActions: true,
      showRulesDrawerHints: true,
      highContrast: false,
      soundEnabled: false,
      hapticsEnabled: false,
      experimental: {
        aiOpponents: false,
        aiCoach: false,
        replayTimeline: false,
        dailyChallenges: false,
        achievements: false,
        lanMultiplayer: false,
        customRules: false,
        enhancedEventLog: false,
        contextualActionPreviews: false,
        multiplayerPushEnabled: true,
        multiplayerReactionsEnabled: true,
      },
      devModeEnabled: false,
      gamePaused: false,
      pausedGameId: null,
    });
  });

  it('sanitizes invalid values and falls back to defaults', () => {
    localStorage.setItem(
      'monopolyDeal.uiPreferences.v1',
      JSON.stringify({
        version: 1,
        reducedEffects: 'yes',
        tableDensity: 'spacious',
        textScale: 'tiny',
        confirmRiskyActions: 0,
        showRulesDrawerHints: null,
        devModeEnabled: 1,
        gamePaused: null,
      }),
    );

    expect(loadUiPreferences()).toEqual({
      version: 1,
      reducedEffects: true,
      tableDensity: 'cozy',
      tableStyle: 'classic_green',
      textScale: 'normal',
      confirmRiskyActions: true,
      showRulesDrawerHints: true,
      highContrast: false,
      soundEnabled: false,
      hapticsEnabled: false,
      experimental: {
        aiOpponents: false,
        aiCoach: false,
        replayTimeline: false,
        dailyChallenges: false,
        achievements: false,
        lanMultiplayer: false,
        customRules: false,
        enhancedEventLog: false,
        contextualActionPreviews: false,
        multiplayerPushEnabled: true,
        multiplayerReactionsEnabled: true,
      },
      devModeEnabled: true,
      gamePaused: false,
      pausedGameId: null,
    });
  });

  it('round-trips new preference fields via save/load', () => {
    saveUiPreferences({
      version: 1,
      reducedEffects: false,
      tableDensity: 'compact',
      tableStyle: 'neon_arcade',
      textScale: 'large',
      confirmRiskyActions: false,
      showRulesDrawerHints: false,
      highContrast: true,
      soundEnabled: true,
      hapticsEnabled: true,
      experimental: {
        aiOpponents: true,
        aiCoach: true,
        replayTimeline: true,
        dailyChallenges: true,
        achievements: true,
        lanMultiplayer: true,
        customRules: true,
        enhancedEventLog: true,
        contextualActionPreviews: true,
        multiplayerPushEnabled: true,
        multiplayerReactionsEnabled: true,
      },
      devModeEnabled: true,
      gamePaused: true,
      pausedGameId: 'game-123',
    });

    expect(loadUiPreferences()).toEqual({
      version: 1,
      reducedEffects: false,
      tableDensity: 'compact',
      tableStyle: 'neon_arcade',
      textScale: 'large',
      confirmRiskyActions: false,
      showRulesDrawerHints: false,
      highContrast: true,
      soundEnabled: true,
      hapticsEnabled: true,
      experimental: {
        aiOpponents: true,
        aiCoach: true,
        replayTimeline: true,
        dailyChallenges: true,
        achievements: true,
        lanMultiplayer: true,
        customRules: true,
        enhancedEventLog: true,
        contextualActionPreviews: true,
        multiplayerPushEnabled: true,
        multiplayerReactionsEnabled: true,
      },
      devModeEnabled: true,
      gamePaused: true,
      pausedGameId: 'game-123',
    });
  });

  it('clears match history and lifetime stats keys', () => {
    localStorage.setItem('monopolyDeal.matchHistory.v1', JSON.stringify([{ id: 'm1' }]));
    localStorage.setItem('monopolyDeal.lifetimeStats.v1', JSON.stringify({ version: 1, players: { A: { wins: 1 } } }));
    localStorage.setItem('monopolyDeal.growthMetrics.v1', JSON.stringify({ version: 1, events: { share_image_clicked: 1 } }));

    clearMatchHistory();
    clearLifetimeStats();
    clearGrowthMetrics();

    expect(localStorage.getItem('monopolyDeal.matchHistory.v1')).toBeNull();
    expect(localStorage.getItem('monopolyDeal.lifetimeStats.v1')).toBeNull();
    expect(localStorage.getItem('monopolyDeal.growthMetrics.v1')).toBeNull();
  });
});

describe('saved game slots storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function sampleGame(seed: number) {
    return createGame({
      seed,
      players: [
        { id: 'p1', name: 'Alpha' },
        { id: 'p2', name: 'Beta' },
      ],
    });
  }

  it('loads default empty slot collection when missing or invalid', () => {
    expect(loadSavedGames()).toEqual({ version: 1, slots: [] });
    localStorage.setItem('monopolyDeal.savedGames.v1', '{broken');
    expect(loadSavedGames()).toEqual({ version: 1, slots: [] });
  });

  it('creates, renames, and deletes saved slots', () => {
    const created = upsertSavedGameSlot({ gameState: sampleGame(1), name: 'Table Night' });
    expect(created.slots).toHaveLength(1);
    const slotId = created.slots[0].id;
    expect(loadSavedGameSlot(slotId)?.name).toBe('Table Night');

    const renamed = renameSavedGameSlot(slotId, 'Friday Group');
    expect(renamed.slots[0]?.name).toBe('Friday Group');

    const deleted = deleteSavedGameSlot(slotId);
    expect(deleted.slots).toHaveLength(0);
  });

  it('upserts an existing slot and updates its game state', () => {
    const created = upsertSavedGameSlot({ gameState: sampleGame(2), name: 'Session A' });
    const slotId = created.slots[0].id;
    const nextGame = sampleGame(3);
    nextGame.turnCount = 9;

    const updated = upsertSavedGameSlot({ id: slotId, gameState: nextGame, name: 'Session A' });
    expect(updated.slots).toHaveLength(1);
    expect(updated.slots[0].gameState.turnCount).toBe(9);
  });

  it('enforces max of 5 slots for new saves', () => {
    for (let i = 0; i < 5; i += 1) {
      upsertSavedGameSlot({ gameState: sampleGame(100 + i), name: `Slot ${i + 1}` });
    }
    expect(loadSavedGames().slots).toHaveLength(5);
    expect(() => upsertSavedGameSlot({ gameState: sampleGame(999), name: 'Overflow' })).toThrowError('save_slots_full');
  });
});

describe('retention storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads default achievement and daily challenge state when missing', () => {
    const achievements = loadAchievementState();
    expect(achievements.version).toBe(1);
    expect(achievements.counters.wins).toBe(0);
    const challenge = loadDailyChallenge();
    expect(challenge.version).toBe(1);
    expect(challenge.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('round-trips achievement and daily challenge payloads', () => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    saveAchievementState({
      version: 1,
      counters: {
        wins: 3,
        actions: 40,
        gamesPlayed: 4,
        quickWins: 1,
      },
      unlockedAt: {
        first_win: 1000,
      },
    });
    saveDailyChallenge({
      version: 1,
      day: today,
      seed: 12345,
      targetTurns: 13,
      completed: true,
      attempts: 2,
      bestTurnCount: 11,
    });

    expect(loadAchievementState()).toEqual({
      version: 1,
      counters: {
        wins: 3,
        actions: 40,
        gamesPlayed: 4,
        quickWins: 1,
      },
      unlockedAt: {
        first_win: 1000,
        ten_wins: undefined,
        action_century: undefined,
        quick_win: undefined,
      },
    });
    expect(loadDailyChallenge()).toEqual({
      version: 1,
      day: today,
      seed: 12345,
      targetTurns: 13,
      completed: true,
      attempts: 2,
      bestTurnCount: 11,
    });
  });
});
