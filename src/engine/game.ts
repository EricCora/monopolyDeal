import {
  CARD_DEFINITIONS,
  PROPERTY_SET_SIZES,
  getCardDisplayName,
  getCardDefinition,
  type ActionKind,
  type CardDefinition,
  type PropertyColor,
} from '../cards/catalog';
import type {
  Action,
  ApplyResult,
  GameConfig,
  GameEvent,
  GameState,
  LegalAction,
  PendingEffect,
  PlayerId,
  PlayerState,
  PropertyCardPlacement,
  RuleError,
  TurnPrompt,
} from './types';

const MAX_HAND_AT_END_TURN = 7;
const MAX_PLAYS_PER_TURN = 3;
const PROPERTY_COLORS = Object.keys(PROPERTY_SET_SIZES) as PropertyColor[];

function now(): number {
  return Date.now();
}

function rngFromSeed(seed = Math.floor(Math.random() * 1_000_000_000)): () => number {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function shuffle<T>(array: T[], rand: () => number): T[] {
  const clone = [...array];
  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone;
}

function initialProperties(): PlayerState['properties'] {
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

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function pushEvent(events: GameEvent[], type: string, message: string): void {
  events.push({ timestamp: now(), type, message });
}

function error(code: RuleError['code'], message: string): RuleError {
  return { code, message };
}

function getPlayer(state: GameState, playerId: PlayerId): PlayerState | undefined {
  return state.players.find((player) => player.id === playerId);
}

function getCurrentPlayer(state: GameState): PlayerState {
  return state.players[state.currentPlayerIndex];
}

function drawCards(state: GameState, player: PlayerState, amount: number): string[] {
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

function removeFromHand(player: PlayerState, cardId: string): boolean {
  const idx = player.hand.indexOf(cardId);
  if (idx === -1) return false;
  player.hand.splice(idx, 1);
  return true;
}

function addToProperty(player: PlayerState, cardId: string, color: PropertyColor): void {
  player.properties[color].push({ cardId, assignedColor: color });
}

function removePropertyCard(player: PlayerState, color: PropertyColor, cardId: string): PropertyCardPlacement | null {
  const group = player.properties[color];
  const idx = group.findIndex((entry) => entry.cardId === cardId);
  if (idx === -1) return null;
  const [card] = group.splice(idx, 1);
  return card;
}

function cardMoneyValue(cardId: string): number {
  const card = getCardDefinition(cardId);
  return card.moneyValue ?? card.value;
}

function cardLabel(cardId: string): string {
  return getCardDisplayName(cardId);
}

function colorLabel(color: PropertyColor): string {
  return color.replace('_', ' ');
}

function countCompleteSets(player: PlayerState): number {
  return PROPERTY_COLORS.filter((color) => isCompleteSet(player, color)).length;
}

function isCompleteSet(player: PlayerState, color: PropertyColor): boolean {
  const required = PROPERTY_SET_SIZES[color];
  const actual = player.properties[color].filter((item) => {
    const def = getCardDefinition(item.cardId);
    return def.kind === 'property' || def.kind === 'wild';
  }).length;
  return actual >= required;
}

function getRentAmount(player: PlayerState, color: PropertyColor): number {
  const setCards = player.properties[color];
  if (setCards.length === 0) return 0;

  const propertyCount = setCards.filter((item) => {
    const def = getCardDefinition(item.cardId);
    return def.kind === 'property' || def.kind === 'wild';
  }).length;

  const sample = player.hand.concat(player.bank).concat(setCards.map((s) => s.cardId))[0];
  void sample;

  const rentCard = CARD_DEFINITIONS.find((card) => card.actionKind === 'rent' && card.rentMatrix?.[color]);
  const scale = rentCard?.rentMatrix?.[color] ?? [1];
  const base = scale[Math.min(propertyCount, scale.length) - 1] ?? scale[scale.length - 1] ?? 1;

  const houseBonus = setCards.some((item) => getCardDefinition(item.cardId).actionKind === 'house') ? 3 : 0;
  const hotelBonus = setCards.some((item) => getCardDefinition(item.cardId).actionKind === 'hotel') ? 4 : 0;
  return base + houseBonus + hotelBonus;
}

function movablePropertyCards(player: PlayerState): Array<{ color: PropertyColor; cardId: string }> {
  const options: Array<{ color: PropertyColor; cardId: string }> = [];
  for (const color of PROPERTY_COLORS) {
    for (const entry of player.properties[color]) {
      const def = getCardDefinition(entry.cardId);
      if (def.actionKind === 'house' || def.actionKind === 'hotel') continue;
      options.push({ color, cardId: entry.cardId });
    }
  }
  return options;
}

function completeSetColors(player: PlayerState): PropertyColor[] {
  return PROPERTY_COLORS.filter((color) => isCompleteSet(player, color));
}

function generatePaymentOptions(player: PlayerState, targetAmount: number): string[][] {
  const allCards = [
    ...player.bank,
    ...PROPERTY_COLORS.flatMap((color) => player.properties[color].map((entry) => entry.cardId)),
  ];
  if (allCards.length === 0) return [[]];

  const options: string[][] = [];
  const sorted = [...allCards].sort((a, b) => cardMoneyValue(a) - cardMoneyValue(b));

  function backtrack(index: number, selected: string[], total: number): void {
    if (options.length > 25) return;
    if (total >= targetAmount) {
      options.push([...selected]);
      return;
    }
    if (index >= sorted.length) return;

    selected.push(sorted[index]);
    backtrack(index + 1, selected, total + cardMoneyValue(sorted[index]));
    selected.pop();

    backtrack(index + 1, selected, total);
  }

  backtrack(0, [], 0);
  if (options.length === 0) {
    return [sorted];
  }
  return options;
}

function findPropertyColorByCard(player: PlayerState, cardId: string): PropertyColor | null {
  for (const color of PROPERTY_COLORS) {
    if (player.properties[color].some((entry) => entry.cardId === cardId)) {
      return color;
    }
  }
  return null;
}

function canCardBePlacedInColor(card: CardDefinition, color: PropertyColor): boolean {
  if (card.kind === 'property') return card.color === color;
  if (card.kind === 'wild') return (card.colors ?? []).includes(color);
  if (card.kind === 'building') return true;
  return false;
}

function discard(state: GameState, cardId: string): void {
  state.discardPile.push(cardId);
}

function nextPlayerIndex(state: GameState, fromIndex = state.currentPlayerIndex): number {
  return (fromIndex + 1) % state.players.length;
}

function finishTurn(state: GameState, events: GameEvent[]): RuleError | undefined {
  const current = getCurrentPlayer(state);
  if (current.hand.length > MAX_HAND_AT_END_TURN) {
    return error('invalid_action', `You must discard to 7 cards or fewer (currently ${current.hand.length}).`);
  }
  state.currentPlayerIndex = nextPlayerIndex(state);
  state.turn = { phase: 'draw', playsUsed: 0, doubleRentMultiplier: 1 };
  state.turnCount += 1;
  pushEvent(events, 'turn_passed', `${current.name} ended their turn.`);
  return undefined;
}

function consumePlay(state: GameState): void {
  state.turn.playsUsed += 1;
}

function resolveEffect(state: GameState, effect: PendingEffect, events: GameEvent[]): RuleError | undefined {
  if (effect.kind === 'payment') {
    state.pending = { kind: 'payment', payload: effect.payload };
    return undefined;
  }
  if (effect.kind === 'sly_deal') {
    state.pending = { kind: 'sly_deal', payload: effect.payload };
    return undefined;
  }
  if (effect.kind === 'forced_deal') {
    state.pending = { kind: 'forced_deal', payload: effect.payload };
    return undefined;
  }
  if (effect.kind === 'deal_breaker') {
    state.pending = { kind: 'deal_breaker', payload: effect.payload };
    return undefined;
  }
  if (effect.kind === 'rent') {
    state.pending = { kind: 'rent', payload: effect.payload };
    return undefined;
  }
  pushEvent(events, 'noop', 'No effect resolved.');
  return undefined;
}

function maybeOpenCounter(
  state: GameState,
  sourcePlayerId: PlayerId,
  targetPlayerId: PlayerId,
  actionCardId: string,
  effect: PendingEffect,
): boolean {
  const target = getPlayer(state, targetPlayerId);
  if (!target) return false;
  const justSayNo = target.hand.find((cardId) => getCardDefinition(cardId).actionKind === 'just_say_no');
  if (!justSayNo) return false;
  state.pending = {
    kind: 'counter',
    payload: {
      sourcePlayerId,
      targetPlayerId,
      actionCardId,
      effect,
      chain: [],
      awaitingPlayerId: targetPlayerId,
    },
  };
  return true;
}

function continuePaymentChain(state: GameState, request: { sourcePlayerId: PlayerId; amount: number; reason: string; actionCardId: string; remainingTargetPlayerIds?: PlayerId[] }, events: GameEvent[]): void {
  const remaining = [...(request.remainingTargetPlayerIds ?? [])];
  while (remaining.length > 0) {
    const nextTargetPlayerId = remaining.shift();
    if (!nextTargetPlayerId) continue;
    if (!getPlayer(state, nextTargetPlayerId)) continue;
    const nextEffect: PendingEffect = {
      kind: 'payment',
      payload: {
        sourcePlayerId: request.sourcePlayerId,
        targetPlayerId: nextTargetPlayerId,
        amount: request.amount,
        reason: request.reason,
        actionCardId: request.actionCardId,
        remainingTargetPlayerIds: remaining.length > 0 ? [...remaining] : undefined,
      },
    };
    if (!maybeOpenCounter(state, request.sourcePlayerId, nextTargetPlayerId, request.actionCardId, nextEffect)) {
      resolveEffect(state, nextEffect, events);
    }
    return;
  }
}

function checkWinner(state: GameState): void {
  const winner = state.players.find((player) => countCompleteSets(player) >= 3);
  if (winner) {
    state.winnerId = winner.id;
    state.turn.phase = 'finished';
    state.pending = null;
  }
}

function legalForPending(state: GameState, player: PlayerState): LegalAction[] {
  const pending = state.pending;
  if (!pending) return [];

  if (pending.kind === 'counter') {
    const req = pending.payload;
    if (req.awaitingPlayerId !== player.id) return [];
    const jsn = player.hand.filter((cardId) => getCardDefinition(cardId).actionKind === 'just_say_no');
    const actions: LegalAction[] = [
      {
        label: 'Resolve without Just Say No',
        action: { type: 'counter_response', playerId: player.id, useJustSayNo: false },
      },
    ];
    for (const cardId of jsn) {
      actions.push({
        label: `Play Just Say No (${cardLabel(cardId)})`,
        action: { type: 'counter_response', playerId: player.id, useJustSayNo: true, cardId },
      });
    }
    return actions;
  }

  if (pending.kind === 'payment') {
    if (pending.payload.targetPlayerId !== player.id) return [];
    const paymentOptions = generatePaymentOptions(player, pending.payload.amount);
    return paymentOptions.map((cards, idx) => ({
      label: cards.length
        ? `Pay option ${idx + 1}: ${cards.map(cardLabel).join(', ')}`
        : 'Cannot pay (no cards)',
      action: { type: 'pay_request', playerId: player.id, cards },
    }));
  }

  if (pending.kind === 'rent') {
    const req = pending.payload;
    if (req.sourcePlayerId === player.id) {
      const actions: LegalAction[] = [];
      for (const target of state.players) {
        if (target.id === player.id) continue;
        actions.push({
          label: `Charge ${target.name} rent $${req.amount}`,
          action: {
            type: 'play_action',
            playerId: player.id,
            cardId: req.actionCardId,
            targetPlayerId: target.id,
            color: req.color,
          },
        });
      }
      return actions;
    }
    return [];
  }

  if (pending.kind === 'sly_deal') {
    const req = pending.payload;
    if (req.sourcePlayerId !== player.id) return [];
    const target = getPlayer(state, req.targetPlayerId);
    if (!target) return [];
    const choices: LegalAction[] = [];
    for (const color of PROPERTY_COLORS) {
      for (const entry of target.properties[color]) {
        const def = getCardDefinition(entry.cardId);
        if (def.actionKind === 'house' || def.actionKind === 'hotel') continue;
        for (const destColor of PROPERTY_COLORS.filter((candidate) => canCardBePlacedInColor(def, candidate))) {
          choices.push({
            label: `Take ${entry.cardId} from ${target.name} to ${destColor}`,
            action: {
              type: 'sly_deal_pick',
              playerId: player.id,
              cardId: entry.cardId,
              sourceColor: color,
              destinationColor: destColor,
            },
          });
        }
      }
    }
    return choices;
  }

  if (pending.kind === 'forced_deal') {
    const req = pending.payload;
    if (req.sourcePlayerId !== player.id) return [];
    const source = getPlayer(state, req.sourcePlayerId);
    const target = getPlayer(state, req.targetPlayerId);
    if (!source || !target) return [];
    const actions: LegalAction[] = [];
    for (const own of movablePropertyCards(source)) {
      const ownDef = getCardDefinition(own.cardId);
      for (const theirs of movablePropertyCards(target)) {
        for (const destColor of PROPERTY_COLORS.filter((candidate) => canCardBePlacedInColor(theirsDef(theirs.cardId), candidate))) {
          void ownDef;
          actions.push({
            label: `Swap ${own.cardId} for ${theirs.cardId}`,
            action: {
              type: 'forced_deal_pick',
              playerId: player.id,
              giveCardId: own.cardId,
              giveColor: own.color,
              takeCardId: theirs.cardId,
              takeColor: theirs.color,
              destinationColor: destColor,
            },
          });
        }
      }
    }
    return actions;
  }

  if (pending.kind === 'deal_breaker') {
    const req = pending.payload;
    if (req.sourcePlayerId !== player.id) return [];
    const target = getPlayer(state, req.targetPlayerId);
    if (!target) return [];
    return completeSetColors(target).map((color) => ({
      label: `Take complete ${colorLabel(color)} set`,
      action: { type: 'deal_breaker_pick', playerId: player.id, color },
    }));
  }

  return [];
}

function theirsDef(cardId: string): CardDefinition {
  return getCardDefinition(cardId);
}

function legalPlayActions(state: GameState, player: PlayerState): LegalAction[] {
  const actions: LegalAction[] = [];
  if (state.turn.phase !== 'action') return actions;

  for (const cardId of player.hand) {
    const card = getCardDefinition(cardId);

    const moneyPlayable = card.kind === 'money' || card.kind === 'action' || card.kind === 'building' || card.kind === 'wild';
    if (moneyPlayable) {
      actions.push({
        label: `Bank ${card.name}`,
        action: { type: 'play_to_bank', playerId: player.id, cardId },
      });
    }

    if (card.kind === 'property' || card.kind === 'wild') {
      for (const color of PROPERTY_COLORS.filter((candidate) => canCardBePlacedInColor(card, candidate))) {
        actions.push({
          label: `Play ${card.name} to ${colorLabel(color)}`,
          action: { type: 'play_property', playerId: player.id, cardId, color },
        });
      }
    }

    if (card.kind === 'building') {
      for (const color of PROPERTY_COLORS) {
        if (!isCompleteSet(player, color)) continue;
        actions.push({
          label: `Play ${card.name} on ${colorLabel(color)}`,
          action: { type: 'play_property', playerId: player.id, cardId, color },
        });
      }
    }

    if (card.kind === 'action') {
      const actionKind = card.actionKind as ActionKind;
      if (actionKind === 'just_say_no') continue;

      if (actionKind === 'pass_go' || actionKind === 'double_rent' || actionKind === 'its_my_birthday') {
        actions.push({
          label: `Play ${card.name}`,
          action: { type: 'play_action', playerId: player.id, cardId },
        });
        continue;
      }

      if (actionKind === 'debt_collector' || actionKind === 'sly_deal' || actionKind === 'forced_deal' || actionKind === 'deal_breaker') {
        for (const target of state.players) {
          if (target.id === player.id) continue;
          actions.push({
            label: `Play ${card.name} on ${target.name}`,
            action: { type: 'play_action', playerId: player.id, cardId, targetPlayerId: target.id },
          });
        }
      }

      if (actionKind === 'rent' || actionKind === 'rent_wild') {
        const allowedColors = Object.keys(card.rentMatrix ?? {}) as PropertyColor[];
        for (const color of allowedColors) {
          if (player.properties[color].length === 0) continue;
          actions.push({
            label: `Play ${card.name} for ${colorLabel(color)} rent`,
            action: { type: 'play_action', playerId: player.id, cardId, color },
          });
        }
      }
    }
  }

  for (const color of PROPERTY_COLORS) {
    for (const placement of player.properties[color]) {
      const def = getCardDefinition(placement.cardId);
      if (def.kind !== 'wild') continue;
      for (const targetColor of PROPERTY_COLORS.filter((candidate) => canCardBePlacedInColor(def, candidate) && candidate !== color)) {
        actions.push({
          label: `Move ${cardLabel(placement.cardId)} from ${colorLabel(color)} to ${colorLabel(targetColor)}`,
          action: {
            type: 'move_wild',
            playerId: player.id,
            cardId: placement.cardId,
            fromColor: color,
            toColor: targetColor,
          },
        });
      }
    }
  }

  actions.push({ label: 'Pass turn', action: { type: 'pass_turn', playerId: player.id } });

  return actions;
}

export function createGame(config: GameConfig): GameState {
  if (config.players.length < 2 || config.players.length > 4) {
    throw new Error('Monopoly Deal supports 2-4 players.');
  }

  const seed = config.seed ?? Math.floor(Math.random() * 1_000_000_000);
  const rand = rngFromSeed(seed);

  const deck: string[] = [];
  for (const card of CARD_DEFINITIONS) {
    for (let i = 0; i < card.quantity; i += 1) {
      deck.push(`${card.id}#${i + 1}`);
    }
  }

  const shuffled = shuffle(deck, rand);

  const players: PlayerState[] = config.players.map((player) => ({
    id: player.id,
    name: player.name,
    hand: [],
    bank: [],
    properties: initialProperties(),
  }));

  const state: GameState = {
    version: 1,
    createdAt: now(),
    updatedAt: now(),
    deckVersion: 'v1',
    players,
    drawPile: shuffled,
    discardPile: [],
    currentPlayerIndex: 0,
    turn: { phase: 'draw', playsUsed: 0, doubleRentMultiplier: 1 },
    pending: null,
    history: [],
    turnCount: 1,
  };

  for (const player of players) {
    drawCards(state, player, 5);
  }

  return state;
}

export function getLegalActions(state: GameState, playerId: PlayerId): LegalAction[] {
  const player = getPlayer(state, playerId);
  if (!player) return [];
  if (state.winnerId) return [];

  const pendingActions = legalForPending(state, player);
  if (pendingActions.length > 0) return pendingActions;
  if (state.pending) return [];

  const current = getCurrentPlayer(state);
  if (current.id !== playerId) return [];

  if (state.turn.phase === 'draw') {
    return [{ label: 'Draw cards', action: { type: 'draw_cards', playerId } }];
  }

  if (state.turn.phase === 'action') {
    return legalPlayActions(state, player);
  }

  return [];
}

export function applyAction(currentState: GameState, action: Action): ApplyResult {
  const state = cloneState(currentState);
  const events: GameEvent[] = [];

  const player = getPlayer(state, action.playerId);
  if (!player) {
    return { state: currentState, events, error: error('invalid_target', 'Player not found.') };
  }

  const setErr = (err: RuleError): ApplyResult => ({ state: currentState, events, error: err });

  if (state.pending && action.type !== 'counter_response' && action.type !== 'pay_request' && action.type !== 'sly_deal_pick' && action.type !== 'forced_deal_pick' && action.type !== 'deal_breaker_pick' && !(state.pending.kind === 'rent' && action.type === 'play_action')) {
    return setErr(error('unresolved_pending', 'Resolve pending interaction first.'));
  }

  if (action.type === 'draw_cards') {
    if (getCurrentPlayer(state).id !== player.id) return setErr(error('invalid_turn', 'Not your turn.') as RuleError);
    if (state.turn.phase !== 'draw') return setErr(error('invalid_phase', 'Can only draw during draw phase.'));
    const drawAmount = player.hand.length === 0 ? 5 : 2;
    const drawn = drawCards(state, player, drawAmount);
    state.turn.phase = 'action';
    pushEvent(events, 'draw', `${player.name} drew ${drawn.length} cards.`);
  }

  if (action.type === 'pass_turn') {
    if (getCurrentPlayer(state).id !== player.id) return setErr(error('invalid_action', 'Not your turn.'));
    if (state.turn.phase !== 'action') return setErr(error('invalid_phase', 'Cannot pass now.'));
    const err = finishTurn(state, events);
    if (err) return setErr(err);
  }

  if (action.type === 'play_to_bank') {
    if (getCurrentPlayer(state).id !== player.id) return setErr(error('invalid_action', 'Not your turn.'));
    if (state.turn.phase !== 'action') return setErr(error('invalid_phase', 'Cannot play now.'));
    if (state.turn.playsUsed >= MAX_PLAYS_PER_TURN) return setErr(error('illegal_play_limit', 'Already used 3 plays this turn.'));
    if (!removeFromHand(player, action.cardId)) return setErr(error('insufficient_cards', 'Card not in hand.'));
    player.bank.push(action.cardId);
    consumePlay(state);
    pushEvent(events, 'bank', `${player.name} banked ${cardLabel(action.cardId)}.`);
  }

  if (action.type === 'play_property') {
    if (getCurrentPlayer(state).id !== player.id) return setErr(error('invalid_action', 'Not your turn.'));
    if (state.turn.phase !== 'action') return setErr(error('invalid_phase', 'Cannot play now.'));
    if (state.turn.playsUsed >= MAX_PLAYS_PER_TURN) return setErr(error('illegal_play_limit', 'Already used 3 plays this turn.'));
    const card = getCardDefinition(action.cardId);
    if (!removeFromHand(player, action.cardId)) return setErr(error('insufficient_cards', 'Card not in hand.'));

    if (card.kind === 'building') {
      if (!isCompleteSet(player, action.color)) {
        player.hand.push(action.cardId);
        return setErr(error('invalid_action', 'Building requires a complete property set.'));
      }
    } else if (!canCardBePlacedInColor(card, action.color)) {
      player.hand.push(action.cardId);
      return setErr(error('invalid_action', 'Card cannot be placed in that color group.'));
    }

    addToProperty(player, action.cardId, action.color);
    consumePlay(state);
    pushEvent(events, 'property', `${player.name} placed ${cardLabel(action.cardId)} in ${colorLabel(action.color)}.`);
  }

  if (action.type === 'move_wild') {
    if (getCurrentPlayer(state).id !== player.id) return setErr(error('invalid_action', 'Not your turn.'));
    if (state.turn.phase !== 'action') return setErr(error('invalid_phase', 'Cannot move now.'));
    const moved = removePropertyCard(player, action.fromColor, action.cardId);
    if (!moved) return setErr(error('invalid_target', 'Wild card not found in source set.'));
    const def = getCardDefinition(action.cardId);
    if (def.kind !== 'wild' || !canCardBePlacedInColor(def, action.toColor)) {
      addToProperty(player, action.cardId, action.fromColor);
      return setErr(error('invalid_action', 'Card cannot move to target color.'));
    }
    addToProperty(player, action.cardId, action.toColor);
    pushEvent(events, 'wild_move', `${player.name} moved ${cardLabel(action.cardId)} to ${colorLabel(action.toColor)}.`);
  }

  if (action.type === 'play_action') {
    if (state.pending?.kind === 'rent') {
      const pending = state.pending.payload;
      if (pending.sourcePlayerId !== player.id) return setErr(error('invalid_action', 'Only source player can choose rent target.'));
      if (!action.targetPlayerId) return setErr(error('invalid_target', 'Rent target required.'));
      const target = getPlayer(state, action.targetPlayerId);
      if (!target) return setErr(error('invalid_target', 'Target player not found.'));
      const effect: PendingEffect = {
        kind: 'payment',
        payload: {
          sourcePlayerId: player.id,
          targetPlayerId: target.id,
          amount: pending.amount,
          reason: `Rent (${pending.color})`,
          actionCardId: pending.actionCardId,
        },
      };
      state.pending = null;
      const openedCounter = maybeOpenCounter(state, player.id, target.id, pending.actionCardId, effect);
      if (!openedCounter) {
        resolveEffect(state, effect, events);
      }
      pushEvent(events, 'rent_target', `${player.name} charged ${target.name} $${pending.amount} rent.`);
    } else {
      if (getCurrentPlayer(state).id !== player.id) return setErr(error('invalid_action', 'Not your turn.'));
      if (state.turn.phase !== 'action') return setErr(error('invalid_phase', 'Cannot play now.'));
      if (state.turn.playsUsed >= MAX_PLAYS_PER_TURN) return setErr(error('illegal_play_limit', 'Already used 3 plays this turn.'));
      const card = getCardDefinition(action.cardId);
      if (card.kind !== 'action' && card.kind !== 'building') return setErr(error('invalid_action', 'Not an action card.'));
      if (card.actionKind === 'just_say_no') return setErr(error('invalid_action', 'Just Say No can only be played as response.'));
      if (!removeFromHand(player, action.cardId)) return setErr(error('insufficient_cards', 'Card not in hand.'));
      discard(state, action.cardId);

      const actionKind = card.actionKind as ActionKind;

      if (actionKind === 'pass_go') {
        const drawn = drawCards(state, player, 2);
        pushEvent(events, 'action', `${player.name} played Pass Go and drew ${drawn.length}.`);
      }

      if (actionKind === 'double_rent') {
        state.turn.doubleRentMultiplier *= 2;
        pushEvent(events, 'action', `${player.name} played Double Rent.`);
      }

      if (actionKind === 'its_my_birthday') {
        const birthdayTargets = state.players.filter((target) => target.id !== player.id).map((target) => target.id);
        if (birthdayTargets.length > 0) {
          const firstTarget = birthdayTargets[0];
          const paymentEffect: PendingEffect = {
            kind: 'payment',
            payload: {
              sourcePlayerId: player.id,
              targetPlayerId: firstTarget,
              amount: 2,
              reason: "It's My Birthday",
              actionCardId: action.cardId,
              remainingTargetPlayerIds: birthdayTargets.slice(1),
            },
          };
          if (!maybeOpenCounter(state, player.id, firstTarget, action.cardId, paymentEffect)) {
            resolveEffect(state, paymentEffect, events);
          }
        }
        pushEvent(events, 'action', `${player.name} played It's My Birthday.`);
      }

      if (actionKind === 'debt_collector') {
        if (!action.targetPlayerId) return setErr(error('invalid_target', 'Target required.'));
        const target = getPlayer(state, action.targetPlayerId);
        if (!target) return setErr(error('invalid_target', 'Target not found.'));
        const effect: PendingEffect = {
          kind: 'payment',
          payload: {
            sourcePlayerId: player.id,
            targetPlayerId: target.id,
            amount: 5,
            reason: 'Debt Collector',
            actionCardId: action.cardId,
          },
        };
        if (!maybeOpenCounter(state, player.id, target.id, action.cardId, effect)) {
          resolveEffect(state, effect, events);
        }
        pushEvent(events, 'action', `${player.name} played Debt Collector on ${target.name}.`);
      }

      if (actionKind === 'rent' || actionKind === 'rent_wild') {
        if (!action.color) return setErr(error('invalid_target', 'Rent color required.'));
        const allowedColors = Object.keys(card.rentMatrix ?? {}) as PropertyColor[];
        if (!allowedColors.includes(action.color)) return setErr(error('invalid_target', 'Rent card cannot target that color.'));
        const amount = getRentAmount(player, action.color) * state.turn.doubleRentMultiplier;
        state.turn.doubleRentMultiplier = 1;
        state.pending = {
          kind: 'rent',
          payload: {
            sourcePlayerId: player.id,
            actionCardId: action.cardId,
            color: action.color,
            amount,
          },
        };
        pushEvent(events, 'action', `${player.name} played rent for ${colorLabel(action.color)} at $${amount}.`);
      }

      if (actionKind === 'sly_deal') {
        if (!action.targetPlayerId) return setErr(error('invalid_target', 'Target required.'));
        const target = getPlayer(state, action.targetPlayerId);
        if (!target) return setErr(error('invalid_target', 'Target not found.'));
        const effect: PendingEffect = {
          kind: 'sly_deal',
          payload: { sourcePlayerId: player.id, targetPlayerId: target.id, actionCardId: action.cardId },
        };
        if (!maybeOpenCounter(state, player.id, target.id, action.cardId, effect)) {
          resolveEffect(state, effect, events);
        }
        pushEvent(events, 'action', `${player.name} played Sly Deal on ${target.name}.`);
      }

      if (actionKind === 'forced_deal') {
        if (!action.targetPlayerId) return setErr(error('invalid_target', 'Target required.'));
        const target = getPlayer(state, action.targetPlayerId);
        if (!target) return setErr(error('invalid_target', 'Target not found.'));
        const effect: PendingEffect = {
          kind: 'forced_deal',
          payload: { sourcePlayerId: player.id, targetPlayerId: target.id, actionCardId: action.cardId },
        };
        if (!maybeOpenCounter(state, player.id, target.id, action.cardId, effect)) {
          resolveEffect(state, effect, events);
        }
        pushEvent(events, 'action', `${player.name} played Forced Deal on ${target.name}.`);
      }

      if (actionKind === 'deal_breaker') {
        if (!action.targetPlayerId) return setErr(error('invalid_target', 'Target required.'));
        const target = getPlayer(state, action.targetPlayerId);
        if (!target) return setErr(error('invalid_target', 'Target not found.'));
        const effect: PendingEffect = {
          kind: 'deal_breaker',
          payload: { sourcePlayerId: player.id, targetPlayerId: target.id, actionCardId: action.cardId },
        };
        if (!maybeOpenCounter(state, player.id, target.id, action.cardId, effect)) {
          resolveEffect(state, effect, events);
        }
        pushEvent(events, 'action', `${player.name} played Deal Breaker on ${target.name}.`);
      }

      consumePlay(state);
    }
  }

  if (action.type === 'counter_response') {
    if (state.pending?.kind !== 'counter') return setErr(error('invalid_action', 'No counter pending.'));
    const pending = state.pending.payload;
    if (pending.awaitingPlayerId !== player.id) return setErr(error('invalid_action', 'Not your response to counter.'));

    if (action.useJustSayNo) {
      if (!action.cardId) return setErr(error('invalid_action', 'Must select Just Say No card.'));
      if (!removeFromHand(player, action.cardId)) return setErr(error('insufficient_cards', 'Just Say No not in hand.'));
      discard(state, action.cardId);
      pending.chain.push({ playerId: player.id, cardId: action.cardId });
      pending.awaitingPlayerId = pending.awaitingPlayerId === pending.targetPlayerId ? pending.sourcePlayerId : pending.targetPlayerId;
      state.pending = { kind: 'counter', payload: pending };
      pushEvent(events, 'counter', `${player.name} played Just Say No.`);
    } else {
      const canceled = pending.chain.length % 2 === 1;
      state.pending = null;
      if (!canceled) {
        resolveEffect(state, pending.effect, events);
        pushEvent(events, 'counter', 'Action resolved after counter chain.');
      } else {
        if (pending.effect.kind === 'payment') {
          continuePaymentChain(state, pending.effect.payload, events);
        }
        pushEvent(events, 'counter', 'Action canceled by Just Say No chain.');
      }
    }
  }

  if (action.type === 'pay_request') {
    if (state.pending?.kind !== 'payment') return setErr(error('invalid_action', 'No payment pending.'));
    const req = state.pending.payload;
    if (req.targetPlayerId !== player.id) return setErr(error('invalid_action', 'Not your payment request.'));

    const payer = getPlayer(state, req.targetPlayerId);
    const collector = getPlayer(state, req.sourcePlayerId);
    if (!payer || !collector) return setErr(error('invalid_target', 'Player not found.'));

    const selected = new Set(action.cards);
    for (const cardId of selected) {
      const inBank = payer.bank.includes(cardId);
      const inProperty = findPropertyColorByCard(payer, cardId) !== null;
      if (!inBank && !inProperty) {
        return setErr(error('invalid_action', `Cannot pay with ${cardId}.`));
      }
    }

    let total = 0;
    for (const cardId of selected) {
      total += cardMoneyValue(cardId);
      const bankIdx = payer.bank.indexOf(cardId);
      if (bankIdx >= 0) {
        payer.bank.splice(bankIdx, 1);
        collector.bank.push(cardId);
        continue;
      }
      const propColor = findPropertyColorByCard(payer, cardId);
      if (propColor) {
        const removed = removePropertyCard(payer, propColor, cardId);
        if (removed) {
          const def = getCardDefinition(cardId);
          const assign = def.kind === 'property' ? def.color! : propColor;
          addToProperty(collector, cardId, assign);
        }
      }
    }

    state.pending = null;
    pushEvent(events, 'payment', `${payer.name} paid ${collector.name} $${Math.min(total, req.amount)} (${req.reason}).`);
    continuePaymentChain(state, req, events);
  }

  if (action.type === 'sly_deal_pick') {
    if (state.pending?.kind !== 'sly_deal') return setErr(error('invalid_action', 'No sly deal pending.'));
    const req = state.pending.payload;
    if (req.sourcePlayerId !== player.id) return setErr(error('invalid_action', 'Not your sly deal selection.'));
    const source = getPlayer(state, req.sourcePlayerId);
    const target = getPlayer(state, req.targetPlayerId);
    if (!source || !target) return setErr(error('invalid_target', 'Player not found.'));

    const removed = removePropertyCard(target, action.sourceColor, action.cardId);
    if (!removed) return setErr(error('invalid_target', 'Card not found in target set.'));
    const def = getCardDefinition(action.cardId);
    if (!canCardBePlacedInColor(def, action.destinationColor)) {
      addToProperty(target, action.cardId, action.sourceColor);
      return setErr(error('invalid_action', 'Cannot place card in selected destination.'));
    }

    addToProperty(source, action.cardId, action.destinationColor);
    state.pending = null;
    pushEvent(events, 'sly_deal', `${source.name} took ${cardLabel(action.cardId)} from ${target.name}.`);
  }

  if (action.type === 'forced_deal_pick') {
    if (state.pending?.kind !== 'forced_deal') return setErr(error('invalid_action', 'No forced deal pending.'));
    const req = state.pending.payload;
    if (req.sourcePlayerId !== player.id) return setErr(error('invalid_action', 'Not your forced deal selection.'));
    const source = getPlayer(state, req.sourcePlayerId);
    const target = getPlayer(state, req.targetPlayerId);
    if (!source || !target) return setErr(error('invalid_target', 'Player not found.'));

    const give = removePropertyCard(source, action.giveColor, action.giveCardId);
    const take = removePropertyCard(target, action.takeColor, action.takeCardId);
    if (!give || !take) {
      if (give) addToProperty(source, give.cardId, action.giveColor);
      if (take) addToProperty(target, take.cardId, action.takeColor);
      return setErr(error('invalid_target', 'Swap card not found.'));
    }

    const takeDef = getCardDefinition(take.cardId);
    const giveDef = getCardDefinition(give.cardId);
    if (!canCardBePlacedInColor(takeDef, action.destinationColor)) {
      addToProperty(source, give.cardId, action.giveColor);
      addToProperty(target, take.cardId, action.takeColor);
      return setErr(error('invalid_action', 'Cannot place taken card in destination.'));
    }

    addToProperty(source, take.cardId, action.destinationColor);
    const targetDestColor = giveDef.kind === 'property' ? giveDef.color! : action.takeColor;
    addToProperty(target, give.cardId, targetDestColor);

    state.pending = null;
    pushEvent(events, 'forced_deal', `${source.name} swapped ${cardLabel(action.giveCardId)} for ${cardLabel(action.takeCardId)}.`);
  }

  if (action.type === 'deal_breaker_pick') {
    if (state.pending?.kind !== 'deal_breaker') return setErr(error('invalid_action', 'No deal breaker pending.'));
    const req = state.pending.payload;
    if (req.sourcePlayerId !== player.id) return setErr(error('invalid_action', 'Not your deal breaker choice.'));
    const source = getPlayer(state, req.sourcePlayerId);
    const target = getPlayer(state, req.targetPlayerId);
    if (!source || !target) return setErr(error('invalid_target', 'Player not found.'));
    if (!isCompleteSet(target, action.color)) return setErr(error('invalid_action', 'Target set is not complete.'));

    const cards = [...target.properties[action.color]];
    target.properties[action.color] = [];
    for (const entry of cards) {
      const def = getCardDefinition(entry.cardId);
      const destination = def.kind === 'property' ? def.color! : action.color;
      addToProperty(source, entry.cardId, destination);
    }

    state.pending = null;
    pushEvent(events, 'deal_breaker', `${source.name} stole ${target.name}'s ${action.color} set.`);
  }

  checkWinner(state);

  if (events.length > 0) {
    state.history.push(...events);
  }
  state.updatedAt = now();

  return { state, events };
}

export function isGameOver(state: GameState): { done: boolean; winnerId?: PlayerId } {
  if (state.winnerId) return { done: true, winnerId: state.winnerId };
  const winner = state.players.find((player) => countCompleteSets(player) >= 3);
  return winner ? { done: true, winnerId: winner.id } : { done: false };
}

export function getNextPrompt(state: GameState): TurnPrompt {
  const currentPlayer = getCurrentPlayer(state);
  if (state.pending?.kind === 'counter') {
    const pendingPlayer = getPlayer(state, state.pending.payload.awaitingPlayerId);
    return {
      playerId: pendingPlayer?.id ?? currentPlayer.id,
      text: `${pendingPlayer?.name ?? 'Player'}: respond with Just Say No or resolve.`,
      kind: 'response',
    };
  }

  if (state.pending?.kind === 'payment') {
    const pendingPlayer = getPlayer(state, state.pending.payload.targetPlayerId);
    return {
      playerId: pendingPlayer?.id ?? currentPlayer.id,
      text: `${pendingPlayer?.name ?? 'Player'}: choose payment cards totaling $${state.pending.payload.amount}.`,
      kind: 'payment',
    };
  }

  if (state.pending) {
    return {
      playerId: currentPlayer.id,
      text: `${currentPlayer.name}: resolve the pending card effect.`,
      kind: 'selection',
    };
  }

  if (state.turn.phase === 'draw') {
    return {
      playerId: currentPlayer.id,
      text: `${currentPlayer.name}: draw cards to start your turn.`,
      kind: 'draw',
    };
  }

  return {
    playerId: currentPlayer.id,
    text: `${currentPlayer.name}: play up to ${MAX_PLAYS_PER_TURN - state.turn.playsUsed} cards or pass.`,
    kind: 'main',
  };
}

export function getSetCompletionCount(player: PlayerState): number {
  return countCompleteSets(player);
}
