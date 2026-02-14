import { beforeEach, describe, expect, it } from 'vitest';
import {
  incrementGrowthMetric,
  loadGrowthMetrics,
  loadUiPreferences,
  saveGrowthMetrics,
  saveUiPreferences,
} from '../persistence/storage';

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
      },
    });

    localStorage.setItem('monopolyDeal.growthMetrics.v1', '{not-json');
    expect(loadGrowthMetrics()).toEqual({
      version: 1,
      events: {
        share_image_clicked: 0,
        share_image_success: 0,
      },
    });
  });

  it('saves and increments growth metrics event counters', () => {
    saveGrowthMetrics({
      version: 1,
      events: {
        share_image_clicked: 2,
        share_image_success: 1,
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
      textScale: 'large',
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
        devModeEnabled: 1,
        gamePaused: null,
      }),
    );

    expect(loadUiPreferences()).toEqual({
      version: 1,
      reducedEffects: true,
      tableDensity: 'cozy',
      textScale: 'normal',
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
      textScale: 'large',
      devModeEnabled: true,
      gamePaused: true,
      pausedGameId: 'game-123',
    });

    expect(loadUiPreferences()).toEqual({
      version: 1,
      reducedEffects: false,
      tableDensity: 'compact',
      textScale: 'large',
      devModeEnabled: true,
      gamePaused: true,
      pausedGameId: 'game-123',
    });
  });
});
