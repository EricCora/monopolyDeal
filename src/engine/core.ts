import {
  CARD_DEFINITIONS,
  PROPERTY_SET_SIZES,
  formatPropertyColor,
  getCardDefinition,
  getCardDisplayName,
  type CardDefinition,
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
  return state.ruleset ?? DEFAULT_RULESET;
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

function isPropertyCardPlacement(entry: PropertyCardPlacement): boolean {
  const kind = getCardDefinition(entry.cardId).kind;
  return kind === 'property' || kind === 'wild';
}

function isStandardPropertyPlacement(entry: PropertyCardPlacement): boolean {
  return getCardDefinition(entry.cardId).kind === 'property';
}

function propertyCount(set: PropertySetView): number {
  return set.entries.filter(isPropertyCardPlacement).length;
}

function setHasStandardProperty(set: PropertySetView): boolean {
  return set.entries.some(isStandardPropertyPlacement);
}

function setHasBuilding(set: PropertySetView, actionKind: 'house' | 'hotel'): boolean {
  return set.entries.some((entry) => getCardDefinition(entry.cardId).actionKind === actionKind);
}

function isRainbowWild(entry: PropertyCardPlacement): boolean {
  const definition = getCardDefinition(entry.cardId);
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
): string {
  const used = new Set(propertySets(player, color).map((set) => set.setId));
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
export function propertySets(player: PlayerState, color: PropertyColor): PropertySetView[] {
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
    const open = groups.filter((group) => propertyCount(group) < required);
    if (preferStandard) {
      const withStandard = open.find(setHasStandardProperty);
      if (withStandard) return withStandard;
    }
    return open[0] ?? createGroup();
  };

  // Process standard properties first. This makes a legacy [wild, wild,
  // standard] lane become one standard-backed set plus one excess wild.
  for (const entry of untagged.filter(isStandardPropertyPlacement)) {
    chooseOpenGroup(false).entries.push(entry);
  }
  for (const entry of untagged.filter((entry) => isPropertyCardPlacement(entry) && !isStandardPropertyPlacement(entry))) {
    chooseOpenGroup(true).entries.push(entry);
  }
  for (const entry of untagged.filter((entry) => !isPropertyCardPlacement(entry))) {
    const eligible = groups.find((group) =>
      propertyCount(group) >= required
      && !setHasBuilding(group, getCardDefinition(entry.cardId).actionKind as 'house' | 'hotel'),
    );
    (eligible ?? groups[0] ?? createGroup()).entries.push(entry);
  }

  return groups;
}

/** Materialize deterministic IDs for a player before mutating a property lane. */
export function normalizePropertySets(player: PlayerState): void {
  for (const color of PROPERTY_COLORS) {
    for (const set of propertySets(player, color)) {
      for (const entry of set.entries) entry.setId = set.setId;
    }
  }
}

export function getPropertySetEntries(player: PlayerState, color: PropertyColor, setId?: string): PropertyCardPlacement[] {
  const sets = propertySets(player, color);
  if (setId) return sets.find((set) => set.setId === setId)?.entries ?? [];
  return sets[0]?.entries ?? [];
}

export function findPropertySetIdByCard(
  player: PlayerState,
  color: PropertyColor,
  cardId: string,
): string | undefined {
  return propertySets(player, color)
    .find((set) => set.entries.some((entry) => entry.cardId === cardId))?.setId;
}

export function isCompletePropertySet(entries: PropertyCardPlacement[], color: PropertyColor): boolean {
  const required = PROPERTY_SET_SIZES[color];
  const properties = entries.filter(isPropertyCardPlacement);
  return properties.length >= required && properties.some(isStandardPropertyPlacement);
}

export function isBuildingPlacementLegal(
  player: PlayerState,
  color: PropertyColor,
  actionKind: 'house' | 'hotel',
  setId?: string,
): boolean {
  if (color === 'railroad' || color === 'utility') return false;
  const sets = propertySets(player, color);
  const eligible = sets.filter((set) => isCompletePropertySet(set.entries, color));
  const target = setId
    ? eligible.find((set) => set.setId === setId)
    : eligible.find((set) => !setHasBuilding(set, actionKind)
      && (actionKind !== 'hotel' || setHasBuilding(set, 'house')));
  if (!target) return false;
  if (setHasBuilding(target, actionKind)) return false;
  if (actionKind === 'hotel' && !setHasBuilding(target, 'house')) return false;
  return true;
}

export function addToProperty(player: PlayerState, cardId: string, color: PropertyColor, setId?: string): void {
  normalizePropertySets(player);
  const card = getCardDefinition(cardId);
  const required = PROPERTY_SET_SIZES[color];
  const sets = propertySets(player, color);
  let target = setId ? sets.find((set) => set.setId === setId) : undefined;
  // An explicit set id is a physical-group instruction. If this is a newly
  // transferred set, create that group before the normal "first open set"
  // placement heuristic can merge it into an existing lane.
  if (!target && setId) target = { setId, entries: [] };

  if (!target && card.kind === 'building') {
    target = sets.find((set) => isCompletePropertySet(set.entries, color)
      && color !== 'railroad'
      && color !== 'utility'
      && !setHasBuilding(set, card.actionKind as 'house' | 'hotel'));
  }
  if (!target && card.kind !== 'building') {
    const open = sets.filter((set) => propertyCount(set) < required);
    target = card.kind === 'wild'
      ? open.find(setHasStandardProperty) ?? open[0]
      : open[0];
    if (!target && card.kind === 'property') {
      // A standard property can complete a wild-only group. Move one excess
      // wild into its own group first so the original group remains physical.
      const wildOnly = sets.find((set) => !setHasStandardProperty(set) && propertyCount(set) >= required);
      let excessWild: PropertyCardPlacement | undefined;
      for (let index = (wildOnly?.entries.length ?? 0) - 1; index >= 0; index -= 1) {
        const entry = wildOnly?.entries[index];
        if (entry && getCardDefinition(entry.cardId).kind === 'wild') {
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
  player.properties[color].push({ cardId, assignedColor: color, setId: target.setId });
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

export function cardMoneyValue(cardId: string): number {
  const card = getCardDefinition(cardId);
  return card.moneyValue ?? card.value;
}

export function cardLabel(cardId: string): string {
  return getCardDisplayName(cardId);
}

export function colorLabel(color: PropertyColor): string {
  return formatPropertyColor(color);
}

export function countCompleteSets(player: PlayerState): number {
  // Monopoly Deal's victory condition counts completed color groups. Multiple
  // physical groups of one color still matter for protection and rent, but
  // cannot satisfy multiple victory slots.
  return PROPERTY_COLORS.filter((color) => isCompleteSet(player, color)).length;
}

export function isCompleteSet(player: PlayerState, color: PropertyColor, setId?: string): boolean {
  const sets = propertySets(player, color);
  if (setId) {
    const set = sets.find((candidate) => candidate.setId === setId);
    return set ? isCompletePropertySet(set.entries, color) : false;
  }
  return sets.some((set) => isCompletePropertySet(set.entries, color));
}

export function getRentAmount(player: PlayerState, color: PropertyColor): number {
  const rentCard = CARD_DEFINITIONS.find((card) => card.actionKind === 'rent' && card.rentMatrix?.[color]);
  const scale = rentCard?.rentMatrix?.[color] ?? [1];
  const amounts = propertySets(player, color)
    .filter((set) => set.entries.some((entry) => isPropertyCardPlacement(entry) && !isRainbowWild(entry)))
    .map((set) => {
      const propertyCount = set.entries.filter(isPropertyCardPlacement).length;
      const base = scale[Math.min(propertyCount, scale.length) - 1] ?? scale[scale.length - 1] ?? 1;
      const houseBonus = setHasBuilding(set, 'house') ? 3 : 0;
      const hotelBonus = setHasBuilding(set, 'hotel') ? 4 : 0;
      return base + houseBonus + hotelBonus;
    });
  // A rainbow wild in an otherwise empty color lane has no rent value.
  return amounts.length > 0 ? Math.max(...amounts) : 0;
}

export function movablePropertyCards(player: PlayerState): Array<{ color: PropertyColor; cardId: string; setId?: string }> {
  const options: Array<{ color: PropertyColor; cardId: string; setId?: string }> = [];
  for (const color of PROPERTY_COLORS) {
    for (const set of propertySets(player, color)) {
      const protectedSet = isCompletePropertySet(set.entries, color);
      for (const entry of set.entries) {
        const def = getCardDefinition(entry.cardId);
        if (def.actionKind === 'house' || def.actionKind === 'hotel') continue;
        if (protectedSet) continue;
        options.push({ color, cardId: entry.cardId, setId: set.setId });
      }
    }
  }
  return options;
}

export function totalBankValue(player: PlayerState): number {
  return player.bank.reduce((sum, cardId) => sum + cardMoneyValue(cardId), 0);
}

export function totalPayableValue(player: PlayerState): number {
  const propertyValue = PROPERTY_COLORS.flatMap((color) => player.properties[color].map((entry) => entry.cardId))
    .reduce((sum, cardId) => sum + cardMoneyValue(cardId), 0);
  return totalBankValue(player) + propertyValue;
}

export function completeSetColors(player: PlayerState): PropertyColor[] {
  return PROPERTY_COLORS.filter((color) => isCompleteSet(player, color));
}

export function generatePaymentOptions(player: PlayerState, targetAmount: number): string[][] {
  const allCards = [
    ...player.bank,
    ...PROPERTY_COLORS.flatMap((color) => player.properties[color].map((entry) => entry.cardId)),
  ];
  if (allCards.length === 0) return [[]];

  const sorted = [...allCards].sort((left, right) => {
    const valueDelta = cardMoneyValue(left) - cardMoneyValue(right);
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
    if (cardMoneyValue(cardId) === targetAmount) {
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
    backtrack(index + 1, selected, total + cardMoneyValue(sorted[index]));
    selected.pop();

    backtrack(index + 1, selected, total);
  }

  backtrack(0, [], 0);
  if (options.length === 0) addOption(sorted);

  options.sort((left, right) => {
    const leftTotal = left.reduce((sum, cardId) => sum + cardMoneyValue(cardId), 0);
    const rightTotal = right.reduce((sum, cardId) => sum + cardMoneyValue(cardId), 0);
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

function hasPlayableRentCard(player: PlayerState, excludedCardId?: string): boolean {
  for (const handCardId of player.hand) {
    if (handCardId === excludedCardId) continue;
    const handCard = getCardDefinition(handCardId);
    if (handCard.kind !== 'action') continue;
    if (handCard.actionKind !== 'rent' && handCard.actionKind !== 'rent_wild') continue;
    const allowedColors = Object.keys(handCard.rentMatrix ?? {}) as PropertyColor[];
    if (allowedColors.some((color) => getRentAmount(player, color) > 0)) {
      return true;
    }
  }
  return false;
}

export function canPlayDoubleRent(state: GameState, player: PlayerState, excludedCardId: string): boolean {
  const hasPlayBudgetForCombo = state.turn.playsUsed <= ruleset(state).maxPlaysPerTurn - 2;
  if (!hasPlayBudgetForCombo) return false;
  return hasPlayableRentCard(player, excludedCardId);
}

export function discard(state: GameState, cardId: string): void {
  state.discardPile.push(cardId);
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
  pushEvent(events, 'turn_passed', `${current.name} ended their turn.`);
  return undefined;
}

export function consumePlay(state: GameState): void {
  state.turn.playsUsed += 1;
}

export function checkWinner(state: GameState): void {
  const winner = state.players.find((player) => countCompleteSets(player) >= ruleset(state).winCompleteSets);
  if (winner) {
    state.winnerId = winner.id;
    state.turn.phase = 'finished';
    state.pending = null;
  }
}
