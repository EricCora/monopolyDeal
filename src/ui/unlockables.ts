import type { AchievementStateV1 } from '../stats';
import { TABLE_STYLE_OPTIONS, type TableStylePreset } from './experience';

type UnlockProgress = Pick<AchievementStateV1['counters'], 'wins' | 'actions' | 'quickWins'>;

// Earned from what the stats already count, so nothing new is stored and progress is never lost.

export type CardBackId = 'classic_red' | 'ocean_blue' | 'forest_green' | 'midnight_gold' | 'neon_grid';

export const CARD_BACK_OPTIONS: Array<{ value: CardBackId; label: string }> = [
  { value: 'classic_red', label: 'Classic Red' },
  { value: 'ocean_blue', label: 'Ocean Blue' },
  { value: 'forest_green', label: 'Forest Green' },
  { value: 'midnight_gold', label: 'Midnight Gold' },
  { value: 'neon_grid', label: 'Neon Grid' },
];

interface UnlockRule {
  /** What the player has to do, shown beside a locked item. */
  needs: string;
  isUnlocked: (progress: UnlockProgress) => boolean;
}

const TABLE_STYLE_RULES: Partial<Record<TableStylePreset, UnlockRule>> = {
  sunset_lounge: { needs: 'Win a game', isUnlocked: (progress) => progress.wins >= 1 },
  royal_velvet: { needs: 'Make 100 moves', isUnlocked: (progress) => progress.actions >= 100 },
  midnight_vault: { needs: 'Win 10 games', isUnlocked: (progress) => progress.wins >= 10 },
};

const CARD_BACK_RULES: Partial<Record<CardBackId, UnlockRule>> = {
  ocean_blue: { needs: 'Win a game', isUnlocked: (progress) => progress.wins >= 1 },
  forest_green: { needs: 'Win 5 games', isUnlocked: (progress) => progress.wins >= 5 },
  neon_grid: { needs: 'Win within 12 turns', isUnlocked: (progress) => progress.quickWins >= 1 },
  midnight_gold: { needs: 'Win 10 games', isUnlocked: (progress) => progress.wins >= 10 },
};

export interface UnlockableOption<T extends string> {
  value: T;
  label: string;
  unlocked: boolean;
  needs?: string;
}

export function tableStyleOptions(progress: UnlockProgress): Array<UnlockableOption<TableStylePreset>> {
  return TABLE_STYLE_OPTIONS.map((option) => {
    const rule = TABLE_STYLE_RULES[option.value];
    return { value: option.value, label: option.label, unlocked: rule ? rule.isUnlocked(progress) : true, needs: rule?.needs };
  });
}

export function cardBackOptions(progress: UnlockProgress): Array<UnlockableOption<CardBackId>> {
  return CARD_BACK_OPTIONS.map((option) => {
    const rule = CARD_BACK_RULES[option.value];
    return { value: option.value, label: option.label, unlocked: rule ? rule.isUnlocked(progress) : true, needs: rule?.needs };
  });
}

/** What a game's result just earned, for the results screen. */
export function newlyUnlocked(before: UnlockProgress, after: UnlockProgress): string[] {
  const earned = (options: Array<UnlockableOption<string>>, previous: Array<UnlockableOption<string>>) => options
    .filter((option, index) => option.unlocked && !previous[index].unlocked)
    .map((option) => option.label);
  return [
    ...earned(tableStyleOptions(after), tableStyleOptions(before)).map((label) => `${label} table style`),
    ...earned(cardBackOptions(after), cardBackOptions(before)).map((label) => `${label} card back`),
  ];
}
