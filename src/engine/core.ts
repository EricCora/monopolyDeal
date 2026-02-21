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

export function addToProperty(player: PlayerState, cardId: string, color: PropertyColor): void {
  player.properties[color].push({ cardId, assignedColor: color });
}

export function removePropertyCard(
  player: PlayerState,
  color: PropertyColor,
  cardId: string,
): PropertyCardPlacement | null {
  const group = player.properties[color];
  const idx = group.findIndex((entry) => entry.cardId === cardId);
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
  return PROPERTY_COLORS.filter((color) => isCompleteSet(player, color)).length;
}

export function isCompleteSet(player: PlayerState, color: PropertyColor): boolean {
  const required = PROPERTY_SET_SIZES[color];
  const actual = player.properties[color].filter((item) => {
    const def = getCardDefinition(item.cardId);
    return def.kind === 'property' || def.kind === 'wild';
  }).length;
  return actual >= required;
}

export function getRentAmount(player: PlayerState, color: PropertyColor): number {
  const setCards = player.properties[color];
  if (setCards.length === 0) return 0;

  const propertyCount = setCards.filter((item) => {
    const def = getCardDefinition(item.cardId);
    return def.kind === 'property' || def.kind === 'wild';
  }).length;

  const rentCard = CARD_DEFINITIONS.find((card) => card.actionKind === 'rent' && card.rentMatrix?.[color]);
  const scale = rentCard?.rentMatrix?.[color] ?? [1];
  const base = scale[Math.min(propertyCount, scale.length) - 1] ?? scale[scale.length - 1] ?? 1;

  const houseBonus = setCards.some((item) => getCardDefinition(item.cardId).actionKind === 'house') ? 3 : 0;
  const hotelBonus = setCards.some((item) => getCardDefinition(item.cardId).actionKind === 'hotel') ? 4 : 0;
  return base + houseBonus + hotelBonus;
}

export function movablePropertyCards(player: PlayerState): Array<{ color: PropertyColor; cardId: string }> {
  const options: Array<{ color: PropertyColor; cardId: string }> = [];
  for (const color of PROPERTY_COLORS) {
    if (isCompleteSet(player, color)) continue;
    for (const entry of player.properties[color]) {
      const def = getCardDefinition(entry.cardId);
      if (def.actionKind === 'house' || def.actionKind === 'hotel') continue;
      options.push({ color, cardId: entry.cardId });
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
  if (card.kind === 'building') return true;
  return false;
}

export function canCardBeBanked(card: CardDefinition): boolean {
  return card.kind === 'money'
    || card.kind === 'action'
    || card.kind === 'building'
    || card.kind === 'wild';
}

function hasPlayableRentCard(player: PlayerState, excludedCardId?: string): boolean {
  for (const handCardId of player.hand) {
    if (handCardId === excludedCardId) continue;
    const handCard = getCardDefinition(handCardId);
    if (handCard.kind !== 'action') continue;
    if (handCard.actionKind !== 'rent' && handCard.actionKind !== 'rent_wild') continue;
    const allowedColors = Object.keys(handCard.rentMatrix ?? {}) as PropertyColor[];
    if (allowedColors.some((color) => player.properties[color].length > 0)) {
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
