import { formatPropertyColor, getCardDefinition, PROPERTY_SET_SIZES, type ActionKind, type CardDefinition, type GameVariant, type PropertyColor } from '../../cards/catalog';

/** One card in the picker: its id and where it sits in the draw order (0 is the next card). */
export interface DeckPickerCard {
  cardId: string;
  drawIndex: number;
}

export interface DeckPickerGroup {
  key: string;
  label: string;
  cards: DeckPickerCard[];
}

export interface DeckPickerSection {
  key: 'action' | 'money' | 'property';
  title: string;
  count: number;
  groups: DeckPickerGroup[];
}

const COLOR_ORDER = Object.keys(PROPERTY_SET_SIZES) as PropertyColor[];

/** Action families in the order the picker shows them. Anything unlisted follows, by name. */
const ACTION_ORDER: { key: string; label: string; kinds: ActionKind[] }[] = [
  { key: 'pass_go', label: 'Pass Go', kinds: ['pass_go'] },
  { key: 'rent', label: 'Rent', kinds: ['rent', 'rent_wild'] },
  { key: 'double_rent', label: 'Double Rent', kinds: ['double_rent'] },
  { key: 'just_say_no', label: 'Just Say No', kinds: ['just_say_no'] },
  { key: 'deal_breaker', label: 'Deal Breaker', kinds: ['deal_breaker'] },
  { key: 'sly_deal', label: 'Sly Deal', kinds: ['sly_deal'] },
  { key: 'super_sly_deal', label: 'Super Sly Deal', kinds: ['super_sly_deal'] },
  { key: 'forced_deal', label: 'Forced Deal', kinds: ['forced_deal'] },
  { key: 'debt_collector', label: 'Debt Collector', kinds: ['debt_collector'] },
  { key: 'its_my_birthday', label: "It's My Birthday", kinds: ['its_my_birthday'] },
  { key: 'building', label: 'Buildings', kinds: ['house', 'hotel', 'shack'] },
];

/** The earliest board color a card belongs to, for ordering rents and wilds. */
function firstColorIndex(colors: PropertyColor[]): number {
  if (colors.length === 0 || colors.length >= COLOR_ORDER.length) return COLOR_ORDER.length;
  return Math.min(...colors.map((color) => COLOR_ORDER.indexOf(color)));
}

function rentColors(card: CardDefinition): PropertyColor[] {
  return Object.keys(card.rentMatrix ?? {}) as PropertyColor[];
}

/** Where a card goes: its section, its group inside the section, and its place inside the group. */
function placeCard(card: CardDefinition): { section: DeckPickerSection['key']; groupOrder: number; groupKey: string; groupLabel: string; within: number } {
  if (card.kind === 'money') {
    // Biggest money first.
    return { section: 'money', groupOrder: -card.value, groupKey: `money_${card.value}`, groupLabel: `$${card.value}M`, within: 0 };
  }
  if (card.kind === 'property' || card.kind === 'wild') {
    const colors = card.kind === 'property' ? [card.color!] : card.colors ?? [];
    const index = firstColorIndex(colors);
    if (index >= COLOR_ORDER.length) {
      return { section: 'property', groupOrder: COLOR_ORDER.length, groupKey: 'wild_any', groupLabel: 'Any color', within: 0 };
    }
    const color = COLOR_ORDER[index];
    // Plain properties before the two-color wilds that share their color.
    return { section: 'property', groupOrder: index, groupKey: color, groupLabel: formatPropertyColor(color), within: card.kind === 'property' ? 0 : 1 + firstColorIndex(colors.filter((entry) => entry !== color)) };
  }
  const kind = card.actionKind;
  const family = ACTION_ORDER.findIndex((entry) => kind !== undefined && entry.kinds.includes(kind));
  if (family >= 0) {
    const entry = ACTION_ORDER[family];
    // Rents run in board-color order, with any-color rents last.
    const within = entry.key === 'rent' || entry.key === 'double_rent' ? firstColorIndex(rentColors(card)) : 0;
    return { section: 'action', groupOrder: family, groupKey: entry.key, groupLabel: entry.label, within };
  }
  return { section: 'action', groupOrder: ACTION_ORDER.length, groupKey: `other_${card.id}`, groupLabel: card.name, within: 0 };
}

const SECTION_TITLES: Record<DeckPickerSection['key'], string> = { action: 'Actions', money: 'Money', property: 'Properties' };

/**
 * The deck sorted for the picker: actions, then money, then properties. Inside each,
 * cards of a kind sit together (action type, money value, property color), and cards
 * that are alike keep their draw order.
 */
export function groupDeckForPicker(pile: string[], variant: GameVariant): DeckPickerSection[] {
  const placed = pile.map((cardId, drawIndex) => {
    const card = getCardDefinition(cardId, variant);
    return { cardId, drawIndex, card, place: placeCard(card) };
  });
  return (['action', 'money', 'property'] as const).flatMap((sectionKey) => {
    const inSection = placed.filter((entry) => entry.place.section === sectionKey);
    if (inSection.length === 0) return [];
    inSection.sort((a, b) => a.place.groupOrder - b.place.groupOrder
      || a.place.groupLabel.localeCompare(b.place.groupLabel)
      || a.place.within - b.place.within
      || a.card.id.localeCompare(b.card.id)
      || a.drawIndex - b.drawIndex);
    const groups: DeckPickerGroup[] = [];
    for (const entry of inSection) {
      const last = groups[groups.length - 1];
      const card = { cardId: entry.cardId, drawIndex: entry.drawIndex };
      if (last?.key === entry.place.groupKey) last.cards.push(card);
      else groups.push({ key: entry.place.groupKey, label: entry.place.groupLabel, cards: [card] });
    }
    return [{ key: sectionKey, title: SECTION_TITLES[sectionKey], count: inSection.length, groups }];
  });
}
