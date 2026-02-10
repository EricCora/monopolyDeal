import { getCardDefinition, getRentScale, getSetSize, type CardDefinition, type PropertyColor } from '../cards/catalog';

export interface CardVisualModel {
  cardId: string;
  title: string;
  subtitle: string;
  valueBadge: string;
  setSize?: number;
  rentScale?: number[];
  kindClass: 'money' | 'property' | 'wild' | 'action' | 'building';
  themeClass: string;
  accent: string;
  splitAccent?: string;
}

function normalizeColor(color: PropertyColor): string {
  return color.replace('_', '-');
}

function titleFromCard(card: CardDefinition): string {
  if (card.kind === 'money') return `$${card.value}`;
  return card.name;
}

function subtitleFromCard(card: CardDefinition): string {
  if (card.kind === 'money') return 'Money';
  if (card.kind === 'property') return `${card.color?.replace('_', ' ')} property`;
  if (card.kind === 'wild') return `Wild: ${(card.colors ?? []).map((color) => color.replace('_', ' ')).join(' / ')}`;
  if (card.kind === 'building') return 'Building';
  return 'Action';
}

function themeFromCard(card: CardDefinition): { themeClass: string; accent: string; splitAccent?: string } {
  if (card.kind === 'property' && card.color) {
    const normalized = normalizeColor(card.color);
    return { themeClass: `theme-${normalized}`, accent: `var(--card-color-${normalized})` };
  }

  if (card.kind === 'wild') {
    const first = card.colors?.[0] ? normalizeColor(card.colors[0]) : 'wild';
    const second = card.colors?.[1] ? normalizeColor(card.colors[1]) : first;
    return {
      themeClass: 'theme-wild',
      accent: `var(--card-color-${first})`,
      splitAccent: `var(--card-color-${second})`,
    };
  }

  if (card.kind === 'money') {
    return { themeClass: 'theme-money', accent: 'var(--card-money)' };
  }

  if (card.kind === 'building') {
    return { themeClass: 'theme-building', accent: 'var(--card-building)' };
  }

  return { themeClass: 'theme-action', accent: 'var(--card-action)' };
}

export function getCardVisualModel(cardId: string): CardVisualModel {
  const card = getCardDefinition(cardId);
  const theme = themeFromCard(card);
  const setSize = card.kind === 'property' ? getSetSize(card.color!) : undefined;
  const rentScale = card.kind === 'property' ? getRentScale(card.color!) : undefined;

  return {
    cardId,
    title: titleFromCard(card),
    subtitle: subtitleFromCard(card),
    valueBadge: `$${card.moneyValue ?? card.value}`,
    setSize,
    rentScale,
    kindClass: card.kind,
    themeClass: theme.themeClass,
    accent: theme.accent,
    splitAccent: theme.splitAccent,
  };
}
