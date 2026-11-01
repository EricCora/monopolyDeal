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

export type GameVariant = 'classic' | 'no_mercy';

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
  | 'shack'
  | 'go_again'
  | 'forced_debt'
  | 'heist'
  | 'market_crash'
  | 'repossession'
  | 'super_sly_deal'
  | 'tax_collector'
  | 'tough_luck'
  | 'unfair_trade'
  | 'yoink'
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

/** The original catalog remains the Classic source of truth and export. */
export const CLASSIC_CARD_DEFINITIONS = CARD_DEFINITIONS;
export const CLASSIC_CARD_BY_ID = CARD_BY_ID;
export const CLASSIC_DECK_TOTAL_CARDS = DECK_TOTAL_CARDS;

const noMercyActionCards: CardDefinition[] = [
  { id: 'rent_brown_light_blue', name: 'Rent Brown/Light Blue', kind: 'action', actionKind: 'rent_wild', value: 1, moneyValue: 1, rentMatrix: { brown: PROPERTY_RENT_SCALES.brown, light_blue: PROPERTY_RENT_SCALES.light_blue }, quantity: 1 },
  { id: 'rent_pink_orange', name: 'Rent Pink/Orange', kind: 'action', actionKind: 'rent_wild', value: 1, moneyValue: 1, rentMatrix: { pink: PROPERTY_RENT_SCALES.pink, orange: PROPERTY_RENT_SCALES.orange }, quantity: 1 },
  { id: 'rent_red_yellow', name: 'Rent Red/Yellow', kind: 'action', actionKind: 'rent_wild', value: 1, moneyValue: 1, rentMatrix: { red: PROPERTY_RENT_SCALES.red, yellow: PROPERTY_RENT_SCALES.yellow }, quantity: 1 },
  { id: 'rent_green_dark_blue', name: 'Rent Green/Dark Blue', kind: 'action', actionKind: 'rent_wild', value: 1, moneyValue: 1, rentMatrix: { green: PROPERTY_RENT_SCALES.green, dark_blue: PROPERTY_RENT_SCALES.dark_blue }, quantity: 1 },
  { id: 'rent_railroad_utility', name: 'Rent Railroad/Utility', kind: 'action', actionKind: 'rent_wild', value: 1, moneyValue: 1, rentMatrix: { railroad: PROPERTY_RENT_SCALES.railroad, utility: PROPERTY_RENT_SCALES.utility }, quantity: 1 },
  { id: 'double_rent_brown_light_blue', name: 'Double Rent Brown/Light Blue', kind: 'action', actionKind: 'double_rent', value: 1, moneyValue: 1, rentMatrix: { brown: PROPERTY_RENT_SCALES.brown, light_blue: PROPERTY_RENT_SCALES.light_blue }, quantity: 1 },
  { id: 'double_rent_pink_orange', name: 'Double Rent Pink/Orange', kind: 'action', actionKind: 'double_rent', value: 1, moneyValue: 1, rentMatrix: { pink: PROPERTY_RENT_SCALES.pink, orange: PROPERTY_RENT_SCALES.orange }, quantity: 1 },
  { id: 'double_rent_red_yellow', name: 'Double Rent Red/Yellow', kind: 'action', actionKind: 'double_rent', value: 1, moneyValue: 1, rentMatrix: { red: PROPERTY_RENT_SCALES.red, yellow: PROPERTY_RENT_SCALES.yellow }, quantity: 1 },
  { id: 'double_rent_green_dark_blue', name: 'Double Rent Green/Dark Blue', kind: 'action', actionKind: 'double_rent', value: 1, moneyValue: 1, rentMatrix: { green: PROPERTY_RENT_SCALES.green, dark_blue: PROPERTY_RENT_SCALES.dark_blue }, quantity: 1 },
  { id: 'double_rent_railroad_utility', name: 'Double Rent Railroad/Utility', kind: 'action', actionKind: 'double_rent', value: 1, moneyValue: 1, rentMatrix: { railroad: PROPERTY_RENT_SCALES.railroad, utility: PROPERTY_RENT_SCALES.utility }, quantity: 1 },
  { id: 'rent_any_color', name: 'Rent (Any Color)', kind: 'action', actionKind: 'rent', value: 3, moneyValue: 3, rentMatrix: PROPERTY_RENT_SCALES, quantity: 3 },
  { id: 'double_rent_any_color', name: 'Double Rent (Any Color)', kind: 'action', actionKind: 'double_rent', value: 3, moneyValue: 3, rentMatrix: PROPERTY_RENT_SCALES, quantity: 3 },
  { id: 'deal_breaker', name: 'Deal Breaker', kind: 'action', actionKind: 'deal_breaker', value: 3, moneyValue: 3, quantity: 3 },
  { id: 'forced_debt', name: 'Forced Debt', kind: 'action', actionKind: 'forced_debt', value: 2, moneyValue: 2, quantity: 3 },
  { id: 'go_again', name: 'Go Again', kind: 'action', actionKind: 'go_again', value: 1, moneyValue: 1, quantity: 3 },
  { id: 'heist', name: 'Heist', kind: 'action', actionKind: 'heist', value: 4, moneyValue: 4, quantity: 3 },
  { id: 'just_say_no', name: 'Just Say No', kind: 'action', actionKind: 'just_say_no', value: 4, moneyValue: 4, quantity: 5 },
  { id: 'market_crash', name: 'Market Crash', kind: 'action', actionKind: 'market_crash', value: 4, moneyValue: 4, quantity: 3 },
  { id: 'pass_go_go_go', name: 'Pass Go, Go Go!', kind: 'action', actionKind: 'pass_go', value: 1, moneyValue: 1, quantity: 4 },
  { id: 'repossession', name: 'Repossession', kind: 'action', actionKind: 'repossession', value: 5, moneyValue: 5, quantity: 2 },
  { id: 'shack', name: 'Shack', kind: 'building', actionKind: 'shack', value: 3, moneyValue: 3, quantity: 3 },
  { id: 'super_sly_deal', name: 'Super Sly Deal', kind: 'action', actionKind: 'super_sly_deal', value: 3, moneyValue: 3, quantity: 3 },
  { id: 'tax_collector', name: 'Tax Collector', kind: 'action', actionKind: 'tax_collector', value: 5, moneyValue: 5, quantity: 2 },
  { id: 'tough_luck', name: 'Tough Luck', kind: 'action', actionKind: 'tough_luck', value: 5, moneyValue: 5, quantity: 3 },
  { id: 'unfair_trade', name: 'Unfair Trade', kind: 'action', actionKind: 'unfair_trade', value: 4, moneyValue: 4, quantity: 2 },
  { id: 'yoink', name: 'Yoink!', kind: 'action', actionKind: 'yoink', value: 2, moneyValue: 2, quantity: 3 },
];

const noMercyMoneyCards: CardDefinition[] = [
  { id: 'money_1', name: 'M1', kind: 'money', value: 1, quantity: 5 },
  { id: 'money_2', name: 'M2', kind: 'money', value: 2, quantity: 4 },
  { id: 'money_3', name: 'M3', kind: 'money', value: 3, quantity: 3 },
  { id: 'money_4', name: 'M4', kind: 'money', value: 4, quantity: 2 },
  { id: 'money_5', name: 'M5', kind: 'money', value: 5, quantity: 2 },
  { id: 'money_10', name: 'M10', kind: 'money', value: 10, quantity: 1 },
  { id: 'money_15', name: 'M15', kind: 'money', value: 15, quantity: 1 },
];

/** No Mercy keeps the property/money base but has its own action catalog. */
export const NO_MERCY_CARD_DEFINITIONS: CardDefinition[] = [
  ...noMercyMoneyCards,
  ...propertyCards,
  ...wildCards,
  ...noMercyActionCards,
];
export const NO_MERCY_CARD_BY_ID = new Map(NO_MERCY_CARD_DEFINITIONS.map((card) => [card.id, card]));
export const NO_MERCY_DECK_TOTAL_CARDS = NO_MERCY_CARD_DEFINITIONS.reduce((acc, card) => acc + card.quantity, 0);

export interface CardCatalog {
  variant: GameVariant;
  definitions: CardDefinition[];
  byId: Map<string, CardDefinition>;
  deckTotalCards: number;
}

export const CLASSIC_CATALOG: CardCatalog = {
  variant: 'classic', definitions: CLASSIC_CARD_DEFINITIONS, byId: CLASSIC_CARD_BY_ID, deckTotalCards: CLASSIC_DECK_TOTAL_CARDS,
};
export const NO_MERCY_CATALOG: CardCatalog = {
  variant: 'no_mercy', definitions: NO_MERCY_CARD_DEFINITIONS, byId: NO_MERCY_CARD_BY_ID, deckTotalCards: NO_MERCY_DECK_TOTAL_CARDS,
};

export function getCardCatalog(variant: GameVariant = 'classic'): CardCatalog {
  return variant === 'no_mercy' ? NO_MERCY_CATALOG : CLASSIC_CATALOG;
}

export const getCatalogForVariant = getCardCatalog;
export const getDeckDefinitions = (variant: GameVariant = 'classic'): CardDefinition[] => getCardCatalog(variant).definitions;

export function getCardDefinition(instanceId: string, variant: GameVariant = 'classic'): CardDefinition {
  const cardId = instanceId.split('#')[0];
  const card = getCardCatalog(variant).byId.get(cardId);
  if (!card) {
    throw new Error(`Unknown card id: ${instanceId}`);
  }
  return card;
}

export const getCardDefinitionForVariant = getCardDefinition;

export function isEveryColorWild(cardId: string, variant: GameVariant = 'classic'): boolean {
  const card = getCardDefinition(cardId, variant);
  return card.kind === 'wild' && (card.colors?.length ?? 0) >= Object.keys(PROPERTY_SET_SIZES).length;
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

export function getCardDisplayName(instanceId: string, variant: GameVariant = 'classic'): string {
  const card = getCardDefinition(instanceId, variant);
  if (card.kind === 'money') return `$${card.value} Money`;
  if (card.kind === 'property') return `${colorLabel(card.color!)} Property`;
  if (card.kind === 'wild') {
    if ((card.colors?.length ?? 0) > 4) return 'Wild Card';
    return card.name;
  }
  return card.name;
}
