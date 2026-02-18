import { formatPropertyColor, getCardDefinition, getRentScale, getSetSize, type CardDefinition, type PropertyColor } from '../cards/catalog';
import dealBreakerIcon from './assets/icons/deal_breaker.svg';
import debtCollectorIcon from './assets/icons/debt_collector.svg';
import doubleRentIcon from './assets/icons/double_rent.svg';
import forcedDealIcon from './assets/icons/forced_deal.svg';
import hotelIcon from './assets/icons/hotel.svg';
import houseIcon from './assets/icons/house.svg';
import birthdayIcon from './assets/icons/its_my_birthday.svg';
import justSayNoIcon from './assets/icons/just_say_no.svg';
import passGoIcon from './assets/icons/pass_go.svg';
import rentIcon from './assets/icons/rent.svg';
import slyDealIcon from './assets/icons/sly_deal.svg';

export interface RentStep {
  setCount: number;
  rent: number;
}

export interface CardVisualModel {
  cardId: string;
  title: string;
  subtitle: string;
  valueBadge: string;
  cardRole: 'money' | 'property' | 'wild' | 'action' | 'building';
  colorLabel?: string;
  rentSteps?: RentStep[];
  rentActionLines?: string[];
  setSize?: number;
  actionBadge?: string;
  actionIcon?: string;
  motifClass?: string;
  kindClass: 'money' | 'property' | 'wild' | 'action' | 'building';
  themeClass: string;
  accent: string;
  splitAccent?: string;
}

const ACTION_ICON_BY_KIND = {
  pass_go: passGoIcon,
  rent: rentIcon,
  rent_wild: rentIcon,
  double_rent: doubleRentIcon,
  debt_collector: debtCollectorIcon,
  its_my_birthday: birthdayIcon,
  sly_deal: slyDealIcon,
  forced_deal: forcedDealIcon,
  deal_breaker: dealBreakerIcon,
  just_say_no: justSayNoIcon,
  house: houseIcon,
  hotel: hotelIcon,
} as const;

function normalizeColor(color: PropertyColor): string {
  return color.replace('_', '-');
}

function titleFromCard(card: CardDefinition): string {
  if (card.kind === 'money') return `$${card.value}`;
  return card.name;
}

function subtitleFromCard(card: CardDefinition): string {
  if (card.kind === 'money') return 'Money';
  if (card.kind === 'property') return `${formatPropertyColor(card.color!)} Property`;
  if (card.kind === 'wild') {
    const colors = card.colors ?? [];
    if (colors.length > 4) return 'Wild Any Color';
    return `Wild: ${colors.map((color) => color.replace('_', ' ')).join(' / ')}`;
  }
  if (card.kind === 'building') return 'Building';
  return 'Action';
}

function actionBadgeFromCard(card: CardDefinition): string | undefined {
  if (card.kind === 'action' && card.actionKind) {
    return card.actionKind.replace('_', ' ').replace(/\b\w/g, (value) => value.toUpperCase());
  }
  if (card.kind === 'building' && card.actionKind) {
    return card.actionKind.replace('_', ' ').replace(/\b\w/g, (value) => value.toUpperCase());
  }
  return undefined;
}

function actionIconFromCard(card: CardDefinition): string | undefined {
  if (!card.actionKind) return undefined;
  return ACTION_ICON_BY_KIND[card.actionKind] ?? undefined;
}

function motifClassFromCard(card: CardDefinition): string | undefined {
  if (card.kind === 'property' && card.color) return `motif-${normalizeColor(card.color)}`;
  if (card.kind === 'action' || card.kind === 'building') return 'motif-action';
  if (card.kind === 'wild') return 'motif-wild';
  if (card.kind === 'money') return 'motif-money';
  return undefined;
}

function colorLabelFromCard(card: CardDefinition): string | undefined {
  if (card.kind === 'property' && card.color) return formatPropertyColor(card.color);
  if (card.kind === 'wild' && card.colors?.length) {
    if (card.colors.length > 4) return 'All Property Colors';
    return card.colors.map((color) => formatPropertyColor(color)).join(' / ');
  }
  if (card.kind === 'action' && card.rentMatrix) {
    const colors = Object.keys(card.rentMatrix) as PropertyColor[];
    if (colors.length > 0) return colors.map((color) => formatPropertyColor(color)).join(' / ');
  }
  return undefined;
}

function rentStepsFromScale(rentScale: number[] | undefined): RentStep[] | undefined {
  if (!rentScale || rentScale.length === 0) return undefined;
  return rentScale.map((rent, index) => ({ setCount: index + 1, rent }));
}

function rentActionLinesFromCard(card: CardDefinition): string[] | undefined {
  if (card.kind !== 'action') return undefined;
  if (card.actionKind !== 'rent' && card.actionKind !== 'rent_wild') return undefined;
  const entries = Object.entries(card.rentMatrix ?? {}) as Array<[PropertyColor, number[]]>;
  if (entries.length === 0) return undefined;

  if (card.actionKind === 'rent' && entries.length > 4) {
    const allValues = entries.flatMap(([, scale]) => scale);
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    return ['Any Color Set', `Rent range: $${min}-$${max}`];
  }

  return entries.slice(0, 3).map(([color, scale]) => `${formatPropertyColor(color)} ${scale.map((rent) => `$${rent}`).join('/')}`);
}

function themeFromCard(card: CardDefinition): { themeClass: string; accent: string; splitAccent?: string } {
  if (card.kind === 'property' && card.color) {
    const normalized = normalizeColor(card.color);
    return { themeClass: `theme-${normalized}`, accent: `var(--card-color-${normalized})` };
  }

  if (card.kind === 'wild') {
    if ((card.colors?.length ?? 0) > 4) {
      return {
        themeClass: 'theme-wild-any',
        accent: 'var(--card-rent-any)',
      };
    }
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

  if (card.kind === 'action' && card.actionKind === 'rent') {
    return { themeClass: 'theme-rent-any', accent: 'var(--card-rent-any)' };
  }

  if (card.kind === 'action' && card.actionKind === 'rent_wild') {
    const rentColors = Object.keys(card.rentMatrix ?? {});
    const first = rentColors[0] ? normalizeColor(rentColors[0] as PropertyColor) : 'action';
    const second = rentColors[1] ? normalizeColor(rentColors[1] as PropertyColor) : first;
    return {
      themeClass: 'theme-rent-wild',
      accent: `var(--card-color-${first})`,
      splitAccent: `var(--card-color-${second})`,
    };
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
    cardRole: card.kind,
    colorLabel: colorLabelFromCard(card),
    rentSteps: rentStepsFromScale(rentScale),
    rentActionLines: rentActionLinesFromCard(card),
    setSize,
    actionBadge: actionBadgeFromCard(card),
    actionIcon: actionIconFromCard(card),
    motifClass: motifClassFromCard(card),
    kindClass: card.kind,
    themeClass: theme.themeClass,
    accent: theme.accent,
    splitAccent: theme.splitAccent,
  };
}
