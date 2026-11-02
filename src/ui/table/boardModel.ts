import { getCardDefinition, type GameVariant, type PropertyColor } from '../../cards/catalog';
import { isCompletePropertySet, propertySets } from '../../engine/core';
import type { PlayerState, PropertyCardPlacement } from '../../engine/types';

export const PROPERTY_COLORS: PropertyColor[] = ['brown', 'light_blue', 'pink', 'orange', 'red', 'yellow', 'green', 'dark_blue', 'railroad', 'utility'];

export interface BoardLane {
  id: string;
  color: PropertyColor;
  setId: string;
  setNumber: number;
  entries: PropertyCardPlacement[];
  isComplete: boolean;
}

export function boardLanes(player: PlayerState, variant: GameVariant): BoardLane[] {
  return PROPERTY_COLORS.flatMap((color) => {
    if (player.properties[color].length === 0) return [];
    return propertySets(player, color, variant).map((set, index) => ({
      id: `${color}-${set.setId}`,
      color,
      setId: set.setId,
      setNumber: index + 1,
      entries: set.entries,
      isComplete: isCompletePropertySet(set.entries, color, variant),
    }));
  });
}

export function bankTotal(player: PlayerState, variant: GameVariant): number {
  return player.bank.reduce((sum, cardId) => {
    const card = getCardDefinition(cardId, variant);
    return sum + (card.moneyValue ?? card.value);
  }, 0);
}

export function cssColor(color: PropertyColor): string {
  return `var(--card-color-${color.replace('_', '-')})`;
}

/** m:ss, or hours and days for a turn-by-turn room's long waits. */
export function formatClock(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 3600) return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const hours = Math.floor(seconds / 3600);
  if (hours < 48) return `${hours}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
