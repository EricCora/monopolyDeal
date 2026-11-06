import {
  CARD_DEFINITIONS,
  PROPERTY_SET_SIZES,
  formatPropertyColor,
  getCardDefinition,
  getCardDisplayName,
  isEveryColorWild,
  type CardDefinition,
  type GameVariant,
  type PropertyColor,
} from '../cards/catalog';
import type {
  GameEvent,
  GameState,
  PlayerId,
  PlayerState,
  PropertyCardPlacement,
  RulesetV1,
  RuleError,
} from './types';

export const MAX_HAND_AT_END_TURN = 7;
export const DEFAULT_RULESET: RulesetV1 = {
  winCompleteSets: 3,
  maxHandAtEndTurn: MAX_HAND_AT_END_TURN,
  maxPlaysPerTurn: 3,
};

export const PROPERTY_COLORS = Object.keys(PROPERTY_SET_SIZES) as PropertyColor[];

/** Legacy v1 snapshots have no variant field and are always Classic. */
export function gameVariant(state: Pick<GameState, 'variant'>): GameVariant {
  return state.variant === 'no_mercy' ? 'no_mercy' : 'classic';
}
export const getGameVariant = gameVariant;

/** Normalize persisted v1 snapshots. Missing variant fields are legacy Classic. */
export function normalizeGameState(input: GameState): GameState {
  const state = structuredClone(input) as GameState;
  const variant: GameVariant = state.variant === 'no_mercy' ? 'no_mercy' : 'classic';
  state.variant = variant;
  if (variant === 'no_mercy') state.ruleset = { ...DEFAULT_RULESET };
  state.players = state.players.map((player) => ({
    ...player,
    debts: player.debts ?? player.debtsOwed ?? [],
    debtsOwed: player.debts ?? player.debtsOwed ?? [],
    ...(variant === 'no_mercy' ? {
      debtChipsRemaining: player.debtChipsRemaining ?? 3,
      debtChipsHeld: player.debtChipsHeld ?? player.debtChips ?? [],
      debtChips: player.debtChipsHeld ?? player.debtChips ?? [],
    } : {}),
  }));
  return state;
}

export function now(): number {
  return Date.now();
}

export function rngFromSeed(seed = Math.floor(Math.random() * 1_000_000_000)): () => number {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

export function shuffle<T>(array: T[], rand: () => number): T[] {
  const clone = [...array];
  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone;
}

export function initialProperties(): PlayerState['properties'] {
  return {
    brown: [],
    light_blue: [],
    pink: [],
    orange: [],
    red: [],
    yellow: [],
    green: [],
    dark_blue: [],
    railroad: [],
    utility: [],
  };
}

export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

export function ruleset(state: GameState): RulesetV1 {
  return state.variant === 'no_mercy' ? DEFAULT_RULESET : state.ruleset ?? DEFAULT_RULESET;
}

export function pushEvent(events: GameEvent[], type: string, message: string, details?: GameEvent['details']): void {
  const nextEvent: GameEvent = { timestamp: now(), type, message };
  if (details) nextEvent.details = details;
  events.push(nextEvent);
}

export function error(code: RuleError['code'], message: string): RuleError {
  return { code, message };
}

export function getPlayer(state: GameState, playerId: PlayerId): PlayerState | undefined {
  return state.players.find((player) => player.id === playerId);
}

export function getCurrentPlayer(state: GameState): PlayerState {
  return state.players[state.currentPlayerIndex];
}

export function drawCards(state: GameState, player: PlayerState, amount: number): string[] {
  const drawn: string[] = [];
  for (let i = 0; i < amount; i += 1) {
    if (state.drawPile.length === 0) {
      if (state.discardPile.length === 0) break;
      const rand = rngFromSeed(state.turnCount + state.history.length + 1);
      state.drawPile = shuffle(state.discardPile, rand);
      state.discardPile = [];
    }
    const card = state.drawPile.pop();
    if (card) {
      player.hand.push(card);
      drawn.push(card);
    }
  }
  return drawn;
}

export function removeFromHand(player: PlayerState, cardId: string): boolean {
  const idx = player.hand.indexOf(cardId);
  if (idx === -1) return false;
  player.hand.splice(idx, 1);
  return true;
}

export interface PropertySetView {
  setId: string;
  entries: PropertyCardPlacement[];
}

function isPropertyCardPlacement(entry: PropertyCardPlacement, variant: GameVariant = 'classic'): boolean {
  const kind = getCardDefinition(entry.cardId, variant).kind;
  return kind === 'property' || kind === 'wild';
}

function isStandardPropertyPlacement(entry: PropertyCardPlacement, variant: GameVariant = 'classic'): boolean {
  return getCardDefinition(entry.cardId, variant).kind === 'property';
}

function propertyCount(set: PropertySetView, variant: GameVariant = 'classic'): number {
  return set.entries.filter((entry) => isPropertyCardPlacement(entry, variant)).length;
}

function setHasStandardProperty(set: PropertySetView, variant: GameVariant = 'classic'): boolean {
  return set.entries.some((entry) => isStandardPropertyPlacement(entry, variant));
}

function setHasBuilding(set: PropertySetView, actionKind: 'house' | 'hotel' | 'shack', variant: GameVariant = 'classic'): boolean {
  return set.entries.some((entry) => getCardDefinition(entry.cardId, variant).actionKind === actionKind);
}

function isRainbowWild(entry: PropertyCardPlacement, variant: GameVariant = 'classic'): boolean {
  const definition = getCardDefinition(entry.cardId, variant);
  return definition.kind === 'wild' && (definition.colors?.length ?? 0) >= PROPERTY_COLORS.length;
}

function generatedSetId(color: PropertyColor, index: number): string {
  return `${color}:auto-${index}`;
}

/** Allocate a deterministic set id that cannot merge with an existing lane. */
export function allocatePropertySetId(
  player: PlayerState,
  color: PropertyColor,
  preferred = `${color}:auto`,
  variant: GameVariant = 'classic',
): string {
  const used = new Set(propertySets(player, color, variant).map((set) => set.setId));
  if (!used.has(preferred)) return preferred;
  let suffix = 2;
  while (used.has(`${preferred}-${suffix}`)) suffix += 1;
  return `${preferred}-${suffix}`;
}

/**
 * Derive physical property sets from the legacy color lanes. Untagged cards are
 * assigned deterministically, with standard properties considered before wilds
 * so a wild-only lane can never become a complete set by accident.
 */
export function propertySets(player: PlayerState, color: PropertyColor, variant: GameVariant = 'classic'): PropertySetView[] {
  const entries = player.properties[color] ?? [];
  const required = PROPERTY_SET_SIZES[color];
  const groups: PropertySetView[] = [];
  const byId = new Map<string, PropertySetView>();
  const usedIds = new Set<string>();

  for (const entry of entries) {
    if (!entry.setId) continue;
    let group = byId.get(entry.setId);
    if (!group) {
      group = { setId: entry.setId, entries: [] };
      byId.set(entry.setId, group);
      groups.push(group);
      usedIds.add(entry.setId);
    }
    group.entries.push(entry);
  }

  let nextId = 1;
  const createGroup = (): PropertySetView => {
    while (usedIds.has(generatedSetId(color, nextId))) nextId += 1;
    const group = { setId: generatedSetId(color, nextId), entries: [] };
    nextId += 1;
    groups.push(group);
    usedIds.add(group.setId);
    byId.set(group.setId, group);
    return group;
  };

  const untagged = entries.filter((entry) => !entry.setId);
  const chooseOpenGroup = (preferStandard: boolean): PropertySetView => {
    const open = groups.filter((group) => propertyCount(group, variant) < required);
    if (preferStandard) {
      const withStandard = open.find((set) => setHasStandardProperty(set, variant));
      if (withStandard) return withStandard;
    }
    return open[0] ?? createGroup();
  };

  // Process standard properties first. This makes a legacy [wild, wild,
  // standard] lane become one standard-backed set plus one excess wild.
  for (const entry of untagged.filter((entry) => isStandardPropertyPlacement(entry, variant))) {
    chooseOpenGroup(false).entries.push(entry);
  }
  for (const entry of untagged.filter((entry) => isPropertyCardPlacement(entry, variant) && !isStandardPropertyPlacement(entry, variant))) {
    chooseOpenGroup(true).entries.push(entry);
  }
  for (const entry of untagged.filter((entry) => !isPropertyCardPlacement(entry, variant))) {
    const eligible = groups.find((group) =>
      propertyCount(group, variant) >= required
      && !setHasBuilding(group, getCardDefinition(entry.cardId, variant).actionKind as 'house' | 'hotel' | 'shack', variant),
    );
    (eligible ?? groups[0] ?? createGroup()).entries.push(entry);
  }

  return groups;
}

/** Materialize deterministic IDs for a player before mutating a property lane. */
export function normalizePropertySets(player: PlayerState, variant: GameVariant = 'classic'): void {
  for (const color of PROPERTY_COLORS) {
    for (const set of propertySets(player, color, variant)) {
      for (const entry of set.entries) entry.setId = set.setId;
    }
  }
}

export function getPropertySetEntries(player: PlayerState, color: PropertyColor, setId?: string, variant: GameVariant = 'classic'): PropertyCardPlacement[] {
  const sets = propertySets(player, color, variant);
  if (setId) return sets.find((set) => set.setId === setId)?.entries ?? [];
  return sets[0]?.entries ?? [];
}

export function findPropertySetIdByCard(
  player: PlayerState,
  color: PropertyColor,
  cardId: string,
  variant: GameVariant = 'classic',
): string | undefined {
  return propertySets(player, color, variant)
    .find((set) => set.entries.some((entry) => entry.cardId === cardId))?.setId;
}

export function isCompletePropertySet(entries: PropertyCardPlacement[], color: PropertyColor, variant: GameVariant = 'classic'): boolean {
  const required = PROPERTY_SET_SIZES[color];
  const properties = entries.filter((entry) => isPropertyCardPlacement(entry, variant));
  if (properties.length < required) return false;
  // Any-color Wilds can't complete a set on their own, but anything else can sit beside them.
  return properties.some((entry) => !isEveryColorWild(entry.cardId, variant));
}

function shackCount(entries: PropertyCardPlacement[], variant: GameVariant): number {
  return entries.filter((entry) => getCardDefinition(entry.cardId, variant).actionKind === 'shack').length;
}

function consolidateOnce(player: PlayerState, color: PropertyColor, variant: GameVariant): boolean {
  const required = PROPERTY_SET_SIZES[color];
  const open = propertySets(player, color, variant).filter((set) => !isCompletePropertySet(set.entries, color, variant));
  if (open.length < 2) return false;
  const properties = (set: PropertySetView) => set.entries.filter((entry) => isPropertyCardPlacement(entry, variant));
  const riders = (set: PropertySetView, entry: PropertyCardPlacement) => set.entries.filter((other) => other.attachedToCardId === entry.cardId);

  // A pile full of any-color Wilds needs one real card, and gives back a Wild for it.
  const stuck = open.find((set) => properties(set).length >= required);
  if (stuck) {
    for (const other of open) {
      if (other === stuck) continue;
      const real = properties(other).find((entry) => !isEveryColorWild(entry.cardId, variant) && riders(other, entry).length === 0);
      const spare = [...properties(stuck)].reverse().find((entry) => riders(stuck, entry).length === 0);
      if (real && spare) {
        real.setId = stuck.setId;
        spare.setId = other.setId;
        return true;
      }
    }
    return false;
  }

  const target = open[0];
  for (const source of [...open.slice(1)].reverse()) {
    const candidates = [...properties(source)].reverse()
      .sort((left, right) => Number(isEveryColorWild(left.cardId, variant)) - Number(isEveryColorWild(right.cardId, variant)));
    for (const entry of candidates) {
      const moving = [entry, ...riders(source, entry)];
      const completes = properties(target).length + 1 >= required;
      if (completes && shackCount([...target.entries, ...moving], variant) > 1) continue;
      for (const card of moving) card.setId = target.setId;
      // A building left with nothing under it goes along with the cards.
      if (properties(source).length === 1) {
        for (const left of source.entries) left.setId = target.setId;
      }
      return true;
    }
  }
  return false;
}

/**
 * Piles of one color exist so a spare card has somewhere to go, and paying with a card can
 * leave two partial piles behind. Standard cards can't be moved by hand, so those rejoin here.
 */
export function consolidatePropertySets(player: PlayerState, variant: GameVariant = 'classic'): void {
  for (const color of PROPERTY_COLORS) {
    while (consolidateOnce(player, color, variant));
  }
}

export function isBuildingPlacementLegal(
  player: PlayerState,
  color: PropertyColor,
  actionKind: 'house' | 'hotel',
  setId?: string,
  variant: GameVariant = 'classic',
): boolean {
  if (color === 'railroad' || color === 'utility') return false;
  const sets = propertySets(player, color, variant);
  const eligible = sets.filter((set) => isCompletePropertySet(set.entries, color, variant));
  const target = setId
    ? eligible.find((set) => set.setId === setId)
    : eligible.find((set) => !setHasBuilding(set, actionKind, variant)
      && (actionKind !== 'hotel' || setHasBuilding(set, 'house', variant)));
  if (!target) return false;
  if (setHasBuilding(target, actionKind, variant)) return false;
  if (actionKind === 'hotel' && !setHasBuilding(target, 'house', variant)) return false;
  return true;
}

export function isShackPlacementLegal(
  player: PlayerState,
  color: PropertyColor,
  setId?: string,
  attachedToCardId?: string,
  variant: GameVariant = 'classic',
): boolean {
  const target = setId ? propertySets(player, color, variant).find((set) => set.setId === setId) : propertySets(player, color, variant)[0];
  if (!target) return false;
  const properties = target.entries.filter((entry) => isPropertyCardPlacement(entry, variant));
  if (properties.length === 0) return false;
  // No Mercy allows one Shack on each loose property, but a completed
  // property set may contain only one Shack total.
  if (variant === 'no_mercy'
    && isCompletePropertySet(target.entries, color, variant)
    && target.entries.some((entry) => getCardDefinition(entry.cardId, variant).actionKind === 'shack')) {
    return false;
  }
  if (attachedToCardId) {
    return properties.some((entry) => entry.cardId === attachedToCardId)
      && !target.entries.some((entry) => entry.attachedToCardId === attachedToCardId);
  }
  return properties.some((entry) => !target.entries.some((attachment) => attachment.attachedToCardId === entry.cardId));
}

export function addToProperty(
  player: PlayerState,
  cardId: string,
  color: PropertyColor,
  setId?: string,
  attachedToCardId?: string,
  variant: GameVariant = 'classic',
): void {
  normalizePropertySets(player, variant);
  const card = getCardDefinition(cardId, variant);
  const required = PROPERTY_SET_SIZES[color];
  const sets = propertySets(player, color, variant);
  let target = setId ? sets.find((set) => set.setId === setId) : undefined;
  // An explicit set id is a physical-group instruction. If this is a newly
  // transferred set, create that group before the normal "first open set"
  // placement heuristic can merge it into an existing lane.
  if (!target && setId) target = { setId, entries: [] };

  if (!target && card.kind === 'building') {
    target = sets.find((set) => isCompletePropertySet(set.entries, color, variant)
      && color !== 'railroad'
      && color !== 'utility'
      && !setHasBuilding(set, card.actionKind as 'house' | 'hotel', variant));
  }
  if (!target && card.kind !== 'building') {
    // A complete No Mercy set may hold only one Shack, so a card that would
    // complete a set carrying two starts a new physical set instead.
    const open = sets.filter((set) => propertyCount(set, variant) < required
      && !(variant === 'no_mercy'
        && propertyCount(set, variant) + 1 >= required
        && set.entries.filter((entry) => getCardDefinition(entry.cardId, variant).actionKind === 'shack').length > 1));
    target = card.kind === 'wild'
      ? open.find((set) => setHasStandardProperty(set, variant)) ?? open[0]
      : open[0];
    if (!target && card.kind === 'property') {
      // A standard property can complete a wild-only group. Move one excess
      // wild into its own group first so the original group remains physical.
      const wildOnly = sets.find((set) => !setHasStandardProperty(set, variant)
        && propertyCount(set, variant) >= required
        && !isCompletePropertySet(set.entries, color, variant));
      let excessWild: PropertyCardPlacement | undefined;
      for (let index = (wildOnly?.entries.length ?? 0) - 1; index >= 0; index -= 1) {
        const entry = wildOnly?.entries[index];
        if (entry && getCardDefinition(entry.cardId, variant).kind === 'wild') {
          excessWild = entry;
          break;
        }
      }
      if (wildOnly && excessWild) {
        const used = new Set(sets.map((set) => set.setId));
        let index = 1;
        let nextId = generatedSetId(color, index);
        while (used.has(nextId)) nextId = generatedSetId(color, ++index);
        excessWild.setId = nextId;
        target = wildOnly;
      }
    }
  }
  if (!target) {
    const used = new Set(sets.map((set) => set.setId));
    let index = 1;
    let nextId = generatedSetId(color, index);
    while (used.has(nextId)) nextId = generatedSetId(color, ++index);
    target = { setId: setId ?? nextId, entries: [] };
  }
  player.properties[color].push({ cardId, assignedColor: color, setId: target.setId, ...(attachedToCardId ? { attachedToCardId } : {}) });
}

export function removePropertyCard(
  player: PlayerState,
  color: PropertyColor,
  cardId: string,
  setId?: string,
): PropertyCardPlacement | null {
  const group = player.properties[color];
  const idx = group.findIndex((entry) => entry.cardId === cardId && (!setId || entry.setId === setId));
  if (idx === -1) return null;
  const [card] = group.splice(idx, 1);
  return card;
}

export function attachedPropertyCards(
  player: PlayerState,
  color: PropertyColor,
  cardId: string,
  setId?: string,
): PropertyCardPlacement[] {
  return (player.properties[color] ?? []).filter((entry) =>
    entry.attachedToCardId === cardId && (!setId || entry.setId === setId),
  );
}

export function cardMoneyValue(cardId: string, variant: GameVariant = 'classic'): number {
  const card = getCardDefinition(cardId, variant);
  return card.moneyValue ?? card.value;
}

export function cardLabel(cardId: string, variant: GameVariant = 'classic'): string {
  return getCardDisplayName(cardId, variant);
}

export function colorLabel(color: PropertyColor): string {
  return formatPropertyColor(color);
}

export function countCompleteSets(player: PlayerState, variant: GameVariant = 'classic'): number {
  // Monopoly Deal's victory condition counts completed color groups. Multiple
  // physical groups of one color still matter for protection and rent, but
  // cannot satisfy multiple victory slots.
  return PROPERTY_COLORS.filter((color) => isCompleteSet(player, color, undefined, variant)).length;
}

export function isCompleteSet(player: PlayerState, color: PropertyColor, setId?: string, variant: GameVariant = 'classic'): boolean {
  const sets = propertySets(player, color, variant);
  if (setId) {
    const set = sets.find((candidate) => candidate.setId === setId);
    return set ? isCompletePropertySet(set.entries, color, variant) : false;
  }
  return sets.some((set) => isCompletePropertySet(set.entries, color, variant));
}

export function getRentAmount(player: PlayerState, color: PropertyColor, variant: GameVariant = 'classic'): number {
  const rentCard = CARD_DEFINITIONS.find((card) => card.actionKind === 'rent' && card.rentMatrix?.[color]);
  const scale = rentCard?.rentMatrix?.[color] ?? [1];
  const amounts = propertySets(player, color, variant)
    .filter((set) => set.entries.some((entry) => isPropertyCardPlacement(entry, variant) && !isRainbowWild(entry, variant)))
    .map((set) => {
      const propertyCount = set.entries.filter((entry) => isPropertyCardPlacement(entry, variant)).length;
      const base = scale[Math.min(propertyCount, scale.length) - 1] ?? scale[scale.length - 1] ?? 1;
      const houseBonus = setHasBuilding(set, 'house', variant) ? 3 : 0;
      const hotelBonus = setHasBuilding(set, 'hotel', variant) ? 4 : 0;
      const shackBonus = variant === 'no_mercy'
        ? set.entries.filter((entry) => getCardDefinition(entry.cardId, variant).actionKind === 'shack').length * 5
        : 0;
      return base + houseBonus + hotelBonus + shackBonus;
    });
  // A rainbow wild in an otherwise empty color lane has no rent value.
  return amounts.length > 0 ? Math.max(...amounts) : 0;
}

export function movablePropertyCards(player: PlayerState, variant: GameVariant = 'classic'): Array<{ color: PropertyColor; cardId: string; setId?: string }> {
  const options: Array<{ color: PropertyColor; cardId: string; setId?: string }> = [];
  for (const color of PROPERTY_COLORS) {
    for (const set of propertySets(player, color, variant)) {
      const protectedSet = isCompletePropertySet(set.entries, color, variant);
      for (const entry of set.entries) {
        const def = getCardDefinition(entry.cardId, variant);
        if (def.actionKind === 'house' || def.actionKind === 'hotel' || def.actionKind === 'shack') continue;
        if (protectedSet) continue;
        options.push({ color, cardId: entry.cardId, setId: set.setId });
      }
    }
  }
  return options;
}

export function totalBankValue(player: PlayerState, variant: GameVariant = 'classic'): number {
  return player.bank.reduce((sum, cardId) => sum + cardMoneyValue(cardId, variant), 0);
}

export function totalPayableValue(player: PlayerState, variant: GameVariant = 'classic'): number {
  const payable = (cardId: string) => variant === 'no_mercy' && isEveryColorWild(cardId, variant) ? 0 : cardMoneyValue(cardId, variant);
  const propertyValue = PROPERTY_COLORS.flatMap((color) => player.properties[color].map((entry) => entry.cardId))
    .reduce((sum, cardId) => sum + payable(cardId), 0);
  return player.bank.reduce((sum, cardId) => sum + payable(cardId), 0) + propertyValue;
}

export function completeSetColors(player: PlayerState, variant: GameVariant = 'classic'): PropertyColor[] {
  return PROPERTY_COLORS.filter((color) => isCompleteSet(player, color, undefined, variant));
}

export function generatePaymentOptions(player: PlayerState, targetAmount: number, variant: GameVariant = 'classic'): string[][] {
  const allCards = [
    ...player.bank,
    ...PROPERTY_COLORS.flatMap((color) => player.properties[color].map((entry) => entry.cardId)),
  ].filter((cardId) => !(variant === 'no_mercy' && isEveryColorWild(cardId, variant)));
  if (allCards.length === 0) return [[]];

  const sorted = [...allCards].sort((left, right) => {
    const valueDelta = cardMoneyValue(left, variant) - cardMoneyValue(right, variant);
    if (valueDelta !== 0) return valueDelta;
    return left.localeCompare(right);
  });
  const options: string[][] = [];
  const seen = new Set<string>();
  const MAX_OPTIONS = 120;

  const addOption = (cards: string[]) => {
    if (cards.length === 0) return;
    const normalized = [...cards].sort((left, right) => left.localeCompare(right));
    const key = normalized.join('|');
    if (seen.has(key)) return;
    seen.add(key);
    options.push(normalized);
  };

  for (const cardId of sorted) {
    if (cardMoneyValue(cardId, variant) === targetAmount) {
      addOption([cardId]);
    }
  }

  function backtrack(index: number, selected: string[], total: number): void {
    if (options.length >= MAX_OPTIONS) return;
    if (total >= targetAmount) {
      addOption(selected);
      return;
    }
    if (index >= sorted.length) return;

    selected.push(sorted[index]);
    backtrack(index + 1, selected, total + cardMoneyValue(sorted[index], variant));
    selected.pop();

    backtrack(index + 1, selected, total);
  }

  backtrack(0, [], 0);
  if (options.length === 0) addOption(sorted);

  options.sort((left, right) => {
    const leftTotal = left.reduce((sum, cardId) => sum + cardMoneyValue(cardId, variant), 0);
    const rightTotal = right.reduce((sum, cardId) => sum + cardMoneyValue(cardId, variant), 0);
    const leftMeets = leftTotal >= targetAmount;
    const rightMeets = rightTotal >= targetAmount;
    if (leftMeets !== rightMeets) return leftMeets ? -1 : 1;

    const leftOverpay = leftMeets ? leftTotal - targetAmount : targetAmount - leftTotal;
    const rightOverpay = rightMeets ? rightTotal - targetAmount : targetAmount - rightTotal;
    if (leftOverpay !== rightOverpay) return leftOverpay - rightOverpay;
    if (left.length !== right.length) return left.length - right.length;
    return leftTotal - rightTotal;
  });

  return options.slice(0, 25);
}

/** The cheapest pick from `cards` that reaches `amount`: least overpaid, then fewest banked action cards, then fewest cards. */
function cheapestCover(cards: string[], amount: number, variant: GameVariant): string[] | null {
  const isAction = (cardId: string) => (getCardDefinition(cardId, variant).kind === 'money' ? 0 : 1);
  const ordered = [...cards].sort((left, right) => left.localeCompare(right));
  let picks = new Map<number, string[]>([[0, []]]);
  const better = (left: string[], right: string[]) => {
    const actions = left.reduce((sum, id) => sum + isAction(id), 0) - right.reduce((sum, id) => sum + isAction(id), 0);
    return actions !== 0 ? actions < 0 : left.length < right.length;
  };
  for (const cardId of ordered) {
    const next = new Map(picks);
    for (const [total, pick] of picks) {
      if (total >= amount) continue;
      const sum = total + cardMoneyValue(cardId, variant);
      const candidate = [...pick, cardId];
      const held = next.get(sum);
      if (!held || better(candidate, held)) next.set(sum, candidate);
    }
    picks = next;
  }
  const totals = [...picks.keys()].filter((total) => total >= amount).sort((left, right) => left - right);
  return totals.length > 0 ? picks.get(totals[0]) ?? null : null;
}

/**
 * What a sensible player hands over: the bank first, since that money is spent either way,
 * then cards outside complete sets, and a complete set only when nothing else covers it.
 */
export function suggestPayment(player: PlayerState, amount: number, variant: GameVariant = 'classic'): string[] {
  const payable = (cardId: string) => cardMoneyValue(cardId, variant) > 0 && !(variant === 'no_mercy' && isEveryColorWild(cardId, variant));
  const bank = player.bank.filter(payable);
  const fromBank = cheapestCover(bank, amount, variant);
  if (fromBank) return fromBank;
  const remaining = amount - bank.reduce((sum, cardId) => sum + cardMoneyValue(cardId, variant), 0);

  const loose: string[] = [];
  const complete: string[][] = [];
  for (const color of PROPERTY_COLORS) {
    for (const set of propertySets(player, color, variant)) {
      const cards = set.entries.map((entry) => entry.cardId).filter(payable);
      if (isCompletePropertySet(set.entries, color, variant)) complete.push(cards);
      else loose.push(...cards);
    }
  }
  const worth = (cards: string[]) => cards.reduce((sum, cardId) => sum + cardMoneyValue(cardId, variant), 0);
  complete.sort((left, right) => worth(left) - worth(right) || left.join().localeCompare(right.join()));

  const pool = [...loose];
  for (let added = 0; added <= complete.length; added += 1) {
    const cover = cheapestCover(pool, remaining, variant);
    if (cover) return [...bank, ...cover];
    if (added < complete.length) pool.push(...complete[added]);
  }
  return [...bank, ...pool];
}

export function findPropertyColorByCard(player: PlayerState, cardId: string): PropertyColor | null {
  for (const color of PROPERTY_COLORS) {
    if (player.properties[color].some((entry) => entry.cardId === cardId)) {
      return color;
    }
  }
  return null;
}

export function canCardBePlacedInColor(card: CardDefinition, color: PropertyColor): boolean {
  if (card.kind === 'property') return card.color === color;
  if (card.kind === 'wild') return (card.colors ?? []).includes(color);
  return false;
}

export function canCardBeBanked(card: CardDefinition): boolean {
  return card.kind === 'money'
    || card.kind === 'action'
    || card.kind === 'building';
}

function hasPlayableRentCard(player: PlayerState, excludedCardId?: string, variant: GameVariant = 'classic'): boolean {
  for (const handCardId of player.hand) {
    if (handCardId === excludedCardId) continue;
    const handCard = getCardDefinition(handCardId, variant);
    if (handCard.kind !== 'action') continue;
    if (handCard.actionKind !== 'rent' && handCard.actionKind !== 'rent_wild') continue;
    const allowedColors = Object.keys(handCard.rentMatrix ?? {}) as PropertyColor[];
    if (allowedColors.some((color) => getRentAmount(player, color, variant) > 0)) {
      return true;
    }
  }
  return false;
}

export function canPlayDoubleRent(state: GameState, player: PlayerState, excludedCardId: string, variant: GameVariant = gameVariant(state)): boolean {
  const hasPlayBudgetForCombo = state.turn.playsUsed <= ruleset(state).maxPlaysPerTurn - 2;
  if (!hasPlayBudgetForCombo) return false;
  return hasPlayableRentCard(player, excludedCardId, variant);
}

export function discard(state: GameState, cardId: string): void {
  state.discardPile.push(cardId);
}

/**
 * Property cards, wilds included, may be discarded only when the hand holds
 * nothing else, so a hand of properties alone can still get under the limit.
 */
export function discardableCards(state: GameState, player: PlayerState): string[] {
  const variant = gameVariant(state);
  const isProperty = (cardId: string) => {
    const kind = getCardDefinition(cardId, variant).kind;
    return kind === 'property' || kind === 'wild';
  };
  const others = player.hand.filter((cardId) => !isProperty(cardId));
  return others.length > 0 ? others : [...player.hand];
}

export function nextPlayerIndex(state: GameState, fromIndex = state.currentPlayerIndex): number {
  return (fromIndex + 1) % state.players.length;
}

export function requiresEndTurnDiscard(state: GameState, player: PlayerState): boolean {
  const overHandLimit = player.hand.length > ruleset(state).maxHandAtEndTurn;
  const mustResolveEndTurn =
    Boolean(state.turn.endingTurn) || state.turn.playsUsed >= ruleset(state).maxPlaysPerTurn;
  return !state.pending
    && state.turn.phase === 'action'
    && getCurrentPlayer(state).id === player.id
    && overHandLimit
    && mustResolveEndTurn;
}

export function finishTurn(state: GameState, events: GameEvent[]): RuleError | undefined {
  const current = getCurrentPlayer(state);
  if (current.hand.length > ruleset(state).maxHandAtEndTurn) {
    return error(
      'hand_limit',
      `You must discard to ${ruleset(state).maxHandAtEndTurn} cards or fewer (currently ${current.hand.length}).`,
    );
  }
  state.currentPlayerIndex = nextPlayerIndex(state);
  state.turn = { phase: 'draw', playsUsed: 0, doubleRentMultiplier: 1, endingTurn: false };
  state.turnCount += 1;
  pushEvent(events, 'turn_passed', `${current.name} ended the turn.`);
  endGameIfDeckExhausted(state, events);
  return undefined;
}

/**
 * With every card out of the deck, the discard pile and all hands, no player
 * can ever act again. Award the game on complete sets, then on table value,
 * with seat order as the final tie-break so the result stays deterministic.
 */
function endGameIfDeckExhausted(state: GameState, events: GameEvent[]): void {
  if (state.pending || state.winnerId) return;
  if (state.drawPile.length > 0 || state.discardPile.length > 0) return;
  if (state.players.some((player) => player.hand.length > 0)) return;
  const variant = state.variant ?? 'classic';
  const tableValue = (player: PlayerState) => [
    ...player.bank,
    ...Object.values(player.properties).flat().map((entry) => entry.cardId),
  ].reduce((total, cardId) => total + getCardDefinition(cardId, variant).value, 0);
  const ranked = [...state.players].sort((left, right) => (
    countCompleteSets(right, variant) - countCompleteSets(left, variant)
    || tableValue(right) - tableValue(left)
  ));
  state.winnerId = ranked[0].id;
  state.turn.phase = 'finished';
  pushEvent(events, 'game_over', `The deck ran out. ${ranked[0].name} wins on complete sets and table value.`);
}

export function consumePlay(state: GameState): void {
  state.turn.playsUsed += 1;
}

export function checkWinner(state: GameState): void {
  // A card in the middle of being resolved may still name its pile.
  if (!state.pending) {
    for (const player of state.players) consolidatePropertySets(player, state.variant ?? 'classic');
  }
  const winner = state.players.find((player) => countCompleteSets(player, state.variant ?? 'classic') >= ruleset(state).winCompleteSets);
  if (winner) {
    state.winnerId = winner.id;
    state.turn.phase = 'finished';
    discardCardsHeldByPending(state);
    state.pending = null;
  }
}

/** Cards in transit inside a pending effect would otherwise vanish with it. */
export function discardCardsHeldByPending(state: GameState): void {
  const pending = state.pending;
  if (pending?.kind === 'debt_card') discard(state, pending.payload.cardId);
  if (pending?.kind === 'no_mercy') {
    for (const item of pending.payload.redistribution ?? []) discard(state, item.cardId);
  }
}
