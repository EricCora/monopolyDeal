export type PropertyColor =
  | 'brown'
  | 'light_blue'
  | 'pink'
  | 'orange'
  | 'red'
  | 'yellow'
  | 'green'
  | 'dark_blue'
  | 'railroad'
  | 'utility';

export const PROPERTY_SET_SIZES: Record<PropertyColor, number> = {
  brown: 2,
  light_blue: 3,
  pink: 3,
  orange: 3,
  red: 3,
  yellow: 3,
  green: 3,
  dark_blue: 2,
  railroad: 4,
  utility: 2,
};

export type ActionKind =
  | 'pass_go'
  | 'rent'
  | 'rent_wild'
  | 'double_rent'
  | 'debt_collector'
  | 'its_my_birthday'
  | 'sly_deal'
  | 'forced_deal'
  | 'deal_breaker'
  | 'house'
  | 'hotel'
  | 'just_say_no';

export type CardKind = 'money' | 'property' | 'wild' | 'action' | 'building';

export interface CardDefinition {
  id: string;
  name: string;
  kind: CardKind;
  value: number;
  moneyValue?: number;
  color?: PropertyColor;
  colors?: PropertyColor[];
  actionKind?: ActionKind;
  rentMatrix?: Partial<Record<PropertyColor, number[]>>;
  quantity: number;
}

export const PROPERTY_RENT_SCALES: Record<PropertyColor, number[]> = {
  brown: [1, 2],
  light_blue: [1, 2, 3],
  pink: [1, 2, 4],
  orange: [1, 3, 5],
  red: [2, 3, 6],
  yellow: [2, 4, 6],
  green: [2, 4, 7],
  dark_blue: [3, 8],
  railroad: [1, 2, 3, 4],
  utility: [1, 2],
};

const moneyCards: CardDefinition[] = [
  { id: 'money_1', name: 'M1', kind: 'money', value: 1, quantity: 6 },
  { id: 'money_2', name: 'M2', kind: 'money', value: 2, quantity: 5 },
  { id: 'money_3', name: 'M3', kind: 'money', value: 3, quantity: 3 },
  { id: 'money_4', name: 'M4', kind: 'money', value: 4, quantity: 3 },
  { id: 'money_5', name: 'M5', kind: 'money', value: 5, quantity: 2 },
  { id: 'money_10', name: 'M10', kind: 'money', value: 10, quantity: 1 },
];

const propertyCards: CardDefinition[] = [
  { id: 'brown_1', name: 'Brown', kind: 'property', color: 'brown', value: 1, quantity: 2 },
  { id: 'light_blue_1', name: 'Light Blue', kind: 'property', color: 'light_blue', value: 1, quantity: 3 },
  { id: 'pink_1', name: 'Pink', kind: 'property', color: 'pink', value: 2, quantity: 3 },
  { id: 'orange_1', name: 'Orange', kind: 'property', color: 'orange', value: 2, quantity: 3 },
  { id: 'red_1', name: 'Red', kind: 'property', color: 'red', value: 3, quantity: 3 },
  { id: 'yellow_1', name: 'Yellow', kind: 'property', color: 'yellow', value: 3, quantity: 3 },
  { id: 'green_1', name: 'Green', kind: 'property', color: 'green', value: 4, quantity: 3 },
  { id: 'dark_blue_1', name: 'Dark Blue', kind: 'property', color: 'dark_blue', value: 4, quantity: 2 },
  { id: 'railroad_1', name: 'Railroad', kind: 'property', color: 'railroad', value: 2, quantity: 4 },
  { id: 'utility_1', name: 'Utility', kind: 'property', color: 'utility', value: 2, quantity: 2 },
];

const wildCards: CardDefinition[] = [
  { id: 'wild_blue_green', name: 'Wild Blue/Green', kind: 'wild', colors: ['dark_blue', 'green'], value: 4, quantity: 1 },
  { id: 'wild_brown_light_blue', name: 'Wild Brown/Light Blue', kind: 'wild', colors: ['brown', 'light_blue'], value: 1, quantity: 1 },
  { id: 'wild_light_blue_railroad', name: 'Wild Light Blue/Railroad', kind: 'wild', colors: ['light_blue', 'railroad'], value: 4, quantity: 1 },
  { id: 'wild_pink_orange', name: 'Wild Pink/Orange', kind: 'wild', colors: ['pink', 'orange'], value: 2, quantity: 2 },
  { id: 'wild_red_yellow', name: 'Wild Red/Yellow', kind: 'wild', colors: ['red', 'yellow'], value: 3, quantity: 2 },
  { id: 'wild_railroad_green', name: 'Wild Railroad/Green', kind: 'wild', colors: ['railroad', 'green'], value: 4, quantity: 1 },
  { id: 'wild_railroad_utility', name: 'Wild Railroad/Utility', kind: 'wild', colors: ['railroad', 'utility'], value: 2, quantity: 1 },
  { id: 'wild_all', name: 'Wild Any', kind: 'wild', colors: Object.keys(PROPERTY_SET_SIZES) as PropertyColor[], value: 0, quantity: 2 },
];

const actionCards: CardDefinition[] = [
  { id: 'pass_go', name: 'Pass Go', kind: 'action', actionKind: 'pass_go', value: 1, moneyValue: 1, quantity: 10 },
  {
    id: 'rent_color',
    name: 'Rent (Any Color)',
    kind: 'action',
    actionKind: 'rent',
    value: 3,
    moneyValue: 3,
    rentMatrix: PROPERTY_RENT_SCALES,
    quantity: 3,
  },
  {
    id: 'rent_brown_light_blue',
    name: 'Rent Brown/Light Blue',
    kind: 'action',
    actionKind: 'rent_wild',
    value: 1,
    moneyValue: 1,
    rentMatrix: { brown: PROPERTY_RENT_SCALES.brown, light_blue: PROPERTY_RENT_SCALES.light_blue },
    quantity: 2,
  },
  {
    id: 'rent_pink_orange',
    name: 'Rent Pink/Orange',
    kind: 'action',
    actionKind: 'rent_wild',
    value: 1,
    moneyValue: 1,
    rentMatrix: { pink: PROPERTY_RENT_SCALES.pink, orange: PROPERTY_RENT_SCALES.orange },
    quantity: 2,
  },
  {
    id: 'rent_red_yellow',
    name: 'Rent Red/Yellow',
    kind: 'action',
    actionKind: 'rent_wild',
    value: 1,
    moneyValue: 1,
    rentMatrix: { red: PROPERTY_RENT_SCALES.red, yellow: PROPERTY_RENT_SCALES.yellow },
    quantity: 2,
  },
  {
    id: 'rent_green_dark_blue',
    name: 'Rent Green/Dark Blue',
    kind: 'action',
    actionKind: 'rent_wild',
    value: 1,
    moneyValue: 1,
    rentMatrix: { green: PROPERTY_RENT_SCALES.green, dark_blue: PROPERTY_RENT_SCALES.dark_blue },
    quantity: 2,
  },
  {
    id: 'rent_railroad_utility',
    name: 'Rent Railroad/Utility',
    kind: 'action',
    actionKind: 'rent_wild',
    value: 1,
    moneyValue: 1,
    rentMatrix: { railroad: PROPERTY_RENT_SCALES.railroad, utility: PROPERTY_RENT_SCALES.utility },
    quantity: 2,
  },
  { id: 'double_rent', name: 'Double Rent', kind: 'action', actionKind: 'double_rent', value: 1, moneyValue: 1, quantity: 2 },
  { id: 'debt_collector', name: 'Debt Collector', kind: 'action', actionKind: 'debt_collector', value: 3, moneyValue: 3, quantity: 3 },
  { id: 'its_my_birthday', name: "It's My Birthday", kind: 'action', actionKind: 'its_my_birthday', value: 2, moneyValue: 2, quantity: 3 },
  { id: 'sly_deal', name: 'Sly Deal', kind: 'action', actionKind: 'sly_deal', value: 3, moneyValue: 3, quantity: 3 },
  { id: 'forced_deal', name: 'Forced Deal', kind: 'action', actionKind: 'forced_deal', value: 3, moneyValue: 3, quantity: 3 },
  { id: 'deal_breaker', name: 'Deal Breaker', kind: 'action', actionKind: 'deal_breaker', value: 5, moneyValue: 5, quantity: 2 },
  { id: 'house', name: 'House', kind: 'building', actionKind: 'house', value: 3, moneyValue: 3, quantity: 3 },
  { id: 'hotel', name: 'Hotel', kind: 'building', actionKind: 'hotel', value: 4, moneyValue: 4, quantity: 2 },
  { id: 'just_say_no', name: 'Just Say No', kind: 'action', actionKind: 'just_say_no', value: 4, moneyValue: 4, quantity: 3 },
];

export const CARD_DEFINITIONS: CardDefinition[] = [
  ...moneyCards,
  ...propertyCards,
  ...wildCards,
  ...actionCards,
];

export const CARD_BY_ID = new Map(CARD_DEFINITIONS.map((card) => [card.id, card]));

export const DECK_TOTAL_CARDS = CARD_DEFINITIONS.reduce((acc, card) => acc + card.quantity, 0);

export function getCardDefinition(instanceId: string): CardDefinition {
  const cardId = instanceId.split('#')[0];
  const card = CARD_BY_ID.get(cardId);
  if (!card) {
    throw new Error(`Unknown card id: ${instanceId}`);
  }
  return card;
}

export function getSetSize(color: PropertyColor): number {
  return PROPERTY_SET_SIZES[color];
}

export function getRentScale(color: PropertyColor): number[] {
  return [...PROPERTY_RENT_SCALES[color]];
}

function colorLabel(color: PropertyColor): string {
  return color.replace('_', ' ').replace(/\b\w/g, (value) => value.toUpperCase());
}

export function formatPropertyColor(color: PropertyColor): string {
  return colorLabel(color);
}

export function getCardDisplayName(instanceId: string): string {
  const card = getCardDefinition(instanceId);
  if (card.kind === 'money') return `$${card.value} Money`;
  if (card.kind === 'property') return `${colorLabel(card.color!)} Property`;
  if (card.kind === 'wild') {
    return `Wild ${card.colors?.map(colorLabel).join('/') ?? card.name}`;
  }
  return card.name;
}
