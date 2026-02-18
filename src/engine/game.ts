import { CARD_DEFINITIONS, getCardDefinition, type ActionKind, type PropertyColor } from '../cards/catalog';
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
  RulesetV1,
  RuleError,
  TurnPrompt,
} from './types';
import {
  DEFAULT_RULESET,
  MAX_HAND_AT_END_TURN,
  PROPERTY_COLORS,
  addToProperty,
  canCardBeBanked,
  canCardBePlacedInColor,
  canPlayDoubleRent,
  cardLabel,
  cardMoneyValue,
  checkWinner,
  cloneState,
  colorLabel,
  completeSetColors,
  consumePlay,
  countCompleteSets,
  discard,
  drawCards,
  error,
  findPropertyColorByCard,
  finishTurn,
  generatePaymentOptions,
  getCurrentPlayer,
  getPlayer,
  getRentAmount,
  initialProperties,
  isCompleteSet,
  movablePropertyCards,
  now,
  pushEvent,
  removeFromHand,
  removePropertyCard,
  requiresEndTurnDiscard,
  rngFromSeed,
  ruleset,
  shuffle,
  totalBankValue,
  totalPayableValue,
} from './core';

export { DEFAULT_RULESET, MAX_HAND_AT_END_TURN };

export function getSuggestedPaymentCards(state: GameState, playerId: PlayerId, amount: number): string[] {
  const player = getPlayer(state, playerId);
  if (!player) return [];
  const availableCards = [
    ...player.bank,
    ...PROPERTY_COLORS.flatMap((color) => player.properties[color].map((entry) => entry.cardId)),
  ];
  const exactSingles = availableCards.filter((cardId) => cardMoneyValue(cardId) === amount);
  const exactSingleFromBank = exactSingles
    .filter((cardId) => player.bank.includes(cardId))
    .sort((left, right) => left.localeCompare(right))[0];
  const exactSingle = exactSingleFromBank ?? exactSingles.sort((left, right) => left.localeCompare(right))[0];
  if (exactSingle) return [exactSingle];
  const options = generatePaymentOptions(player, amount);
  if (options.length === 0) return [];

  let best: string[] = options[0];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const option of options) {
    const total = option.reduce((sum, cardId) => sum + cardMoneyValue(cardId), 0);
    const meetsTarget = total >= amount;
    const score = meetsTarget
      ? total * 100 + option.length
      : 1_000_000 - total * 100 + option.length;
    if (score < bestScore) {
      best = option;
      bestScore = score;
    }
  }

  return best;
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
        const requestedAmount = req.amount;
        const collectibleCap = Math.min(requestedAmount, totalPayableValue(target));
        const requiresPropertyTransfer = collectibleCap > totalBankValue(target);
        actions.push({
          label: `Charge ${target.name} rent for ${colorLabel(req.color)}`,
          action: {
            type: 'play_action',
            playerId: player.id,
            cardId: req.actionCardId,
            targetPlayerId: target.id,
            color: req.color,
          },
          targetPlayerId: target.id,
          requestedAmount,
          collectibleCap,
          requiresPropertyTransfer,
          requiresConfirmation: false,
          riskLevel: requiresPropertyTransfer ? 'high' : 'medium',
          previewText: requiresPropertyTransfer
            ? 'This rent likely requires property transfer to cover payment.'
            : 'This rent charge may force the target to pay from their bank.',
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
            label: `Take ${cardLabel(entry.cardId)} from ${target.name} to ${colorLabel(destColor)}`,
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
      for (const theirs of movablePropertyCards(target)) {
        const takenCard = getCardDefinition(theirs.cardId);
        for (const destColor of PROPERTY_COLORS.filter((candidate) => canCardBePlacedInColor(takenCard, candidate))) {
          actions.push({
            label: `Swap ${cardLabel(own.cardId)} for ${cardLabel(theirs.cardId)}`,
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

function legalPlayActions(state: GameState, player: PlayerState): LegalAction[] {
  const actions: LegalAction[] = [];
  if (state.turn.phase !== 'action') return actions;
  const canUsePlay = state.turn.playsUsed < ruleset(state).maxPlaysPerTurn;

  if (canUsePlay) {
    for (const cardId of player.hand) {
      const card = getCardDefinition(cardId);

      const moneyPlayable = canCardBeBanked(card);
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

        if (actionKind === 'pass_go' || actionKind === 'its_my_birthday') {
          actions.push({
            label: `Play ${card.name}`,
            action: { type: 'play_action', playerId: player.id, cardId },
          });
          continue;
        }

        if (actionKind === 'double_rent') {
          if (canPlayDoubleRent(state, player, cardId)) {
            actions.push({
              label: `Play ${card.name}`,
              action: { type: 'play_action', playerId: player.id, cardId },
            });
          }
          continue;
        }

        if (actionKind === 'debt_collector' || actionKind === 'sly_deal' || actionKind === 'forced_deal' || actionKind === 'deal_breaker') {
          const ownMovableCards = movablePropertyCards(player);
          for (const target of state.players) {
            if (target.id === player.id) continue;
            if (actionKind === 'sly_deal' && movablePropertyCards(target).length === 0) continue;
            if (actionKind === 'forced_deal' && (ownMovableCards.length === 0 || movablePropertyCards(target).length === 0)) continue;
            if (actionKind === 'deal_breaker' && completeSetColors(target).length === 0) continue;
            actions.push({
              label: `Play ${card.name} on ${target.name}`,
              action: { type: 'play_action', playerId: player.id, cardId, targetPlayerId: target.id },
              targetPlayerId: target.id,
              requiresConfirmation: true,
              riskLevel: actionKind === 'deal_breaker' || actionKind === 'forced_deal' ? 'high' : 'medium',
              previewText:
                actionKind === 'deal_breaker'
                  ? 'This can steal an entire complete set.'
                  : actionKind === 'forced_deal'
                    ? 'This swaps properties and can reshape both boards.'
                    : actionKind === 'sly_deal'
                      ? 'This steals a property from the selected target.'
                      : 'This demands payment from the selected target.',
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
              requiresConfirmation: true,
              riskLevel: 'medium',
              previewText: `Charge all opponents for ${colorLabel(color)} rent.`,
            });
          }
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

  const ruleset: RulesetV1 = {
    ...DEFAULT_RULESET,
    ...config.ruleset,
  };
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
    controller: player.controller ?? 'human',
    botDifficulty: player.botDifficulty ?? 'easy',
    hand: [],
    bank: [],
    properties: initialProperties(),
  }));

  const state: GameState = {
    version: 1,
    createdAt: now(),
    updatedAt: now(),
    deckVersion: 'v1',
    ruleset,
    players,
    drawPile: shuffled,
    discardPile: [],
    currentPlayerIndex: 0,
    turn: { phase: 'draw', playsUsed: 0, doubleRentMultiplier: 1, endingTurn: false },
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

  if (requiresEndTurnDiscard(state, player)) {
    return player.hand.map((cardId) => ({
      label: `Discard ${cardLabel(cardId)}`,
      action: { type: 'discard_card', playerId, cardId },
    }));
  }

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
    state.turn.endingTurn = false;
    pushEvent(events, 'draw', `${player.name} drew ${drawn.length} cards.`, {
      kind: 'draw',
      playerId: player.id,
      count: drawn.length,
      reason: 'turn_draw',
    });
  }

  if (action.type === 'pass_turn') {
    if (getCurrentPlayer(state).id !== player.id) return setErr(error('invalid_action', 'Not your turn.'));
    if (state.turn.phase !== 'action') return setErr(error('invalid_phase', 'Cannot pass now.'));
    if (player.hand.length > ruleset(state).maxHandAtEndTurn) {
      state.turn.endingTurn = true;
    } else {
      const err = finishTurn(state, events);
      if (err) return setErr(err);
    }
  }

  if (action.type === 'discard_card') {
    if (!requiresEndTurnDiscard(state, player)) return setErr(error('invalid_action', 'Discard is only allowed when over the hand limit at end of turn.'));
    if (!removeFromHand(player, action.cardId)) return setErr(error('insufficient_cards', 'Card not in hand.'));
    discard(state, action.cardId);
    pushEvent(events, 'discard', `${player.name} discarded ${cardLabel(action.cardId)}.`);
    if (state.turn.endingTurn && player.hand.length <= ruleset(state).maxHandAtEndTurn) {
      const err = finishTurn(state, events);
      if (err) return setErr(err);
    }
  }

  if (action.type === 'play_to_bank') {
    if (getCurrentPlayer(state).id !== player.id) return setErr(error('invalid_action', 'Not your turn.'));
    if (state.turn.phase !== 'action') return setErr(error('invalid_phase', 'Cannot play now.'));
    if (state.turn.playsUsed >= ruleset(state).maxPlaysPerTurn) {
      return setErr(error('illegal_play_limit', `Already used ${ruleset(state).maxPlaysPerTurn} plays this turn.`));
    }
    const card = getCardDefinition(action.cardId);
    if (!canCardBeBanked(card)) {
      return setErr(error('invalid_action', 'Only money, action, building, and wild cards can be banked.'));
    }
    if (!removeFromHand(player, action.cardId)) return setErr(error('insufficient_cards', 'Card not in hand.'));
    player.bank.push(action.cardId);
    consumePlay(state);
    pushEvent(events, 'bank', `${player.name} banked ${cardLabel(action.cardId)}.`);
  }

  if (action.type === 'play_property') {
    if (getCurrentPlayer(state).id !== player.id) return setErr(error('invalid_action', 'Not your turn.'));
    if (state.turn.phase !== 'action') return setErr(error('invalid_phase', 'Cannot play now.'));
    if (state.turn.playsUsed >= ruleset(state).maxPlaysPerTurn) {
      return setErr(error('illegal_play_limit', `Already used ${ruleset(state).maxPlaysPerTurn} plays this turn.`));
    }
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
      if (state.turn.playsUsed >= ruleset(state).maxPlaysPerTurn) {
        return setErr(error('illegal_play_limit', `Already used ${ruleset(state).maxPlaysPerTurn} plays this turn.`));
      }
      const card = getCardDefinition(action.cardId);
      if (card.kind !== 'action' && card.kind !== 'building') return setErr(error('invalid_action', 'Not an action card.'));
      if (card.actionKind === 'just_say_no') return setErr(error('invalid_action', 'Just Say No can only be played as response.'));
      const actionKind = card.actionKind as ActionKind;
      let validatedTarget: PlayerState | null = null;

      if (actionKind === 'debt_collector' || actionKind === 'sly_deal' || actionKind === 'forced_deal' || actionKind === 'deal_breaker') {
        if (!action.targetPlayerId) return setErr(error('invalid_target', 'Target required.'));
        const target = getPlayer(state, action.targetPlayerId);
        if (!target) return setErr(error('invalid_target', 'Target not found.'));
        validatedTarget = target;
      }

      if (actionKind === 'sly_deal' && validatedTarget && movablePropertyCards(validatedTarget).length === 0) {
        return setErr(error('invalid_action', 'Target has no movable property cards.'));
      }

      if (actionKind === 'forced_deal' && validatedTarget) {
        if (movablePropertyCards(player).length === 0) return setErr(error('invalid_action', 'You have no movable property cards.'));
        if (movablePropertyCards(validatedTarget).length === 0) {
          return setErr(error('invalid_action', 'Target has no movable property cards.'));
        }
      }

      if (actionKind === 'deal_breaker' && validatedTarget && completeSetColors(validatedTarget).length === 0) {
        return setErr(error('invalid_action', 'Target has no complete property sets.'));
      }

      if (actionKind === 'double_rent') {
        if (!canPlayDoubleRent(state, player, action.cardId)) {
          return setErr(error('invalid_action', 'Double Rent requires a playable rent card this turn.'));
        }
      }

      if (actionKind === 'rent' || actionKind === 'rent_wild') {
        if (!action.color) return setErr(error('invalid_target', 'Rent color required.'));
        const allowedColors = Object.keys(card.rentMatrix ?? {}) as PropertyColor[];
        if (!allowedColors.includes(action.color)) return setErr(error('invalid_target', 'Rent card cannot target that color.'));
      }

      if (!removeFromHand(player, action.cardId)) return setErr(error('insufficient_cards', 'Card not in hand.'));
      discard(state, action.cardId);

      if (actionKind === 'pass_go') {
        const drawn = drawCards(state, player, 2);
        pushEvent(events, 'action', `${player.name} played Pass Go and drew ${drawn.length}.`, {
          kind: 'draw',
          playerId: player.id,
          count: drawn.length,
          reason: 'pass_go',
        });
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
        const target = validatedTarget;
        if (!target) return setErr(error('invalid_target', 'Target required.'));
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
        const target = validatedTarget;
        if (!target) return setErr(error('invalid_target', 'Target required.'));
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
        const target = validatedTarget;
        if (!target) return setErr(error('invalid_target', 'Target required.'));
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
        const target = validatedTarget;
        if (!target) return setErr(error('invalid_target', 'Target required.'));
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

    const total = [...selected].reduce((sum, cardId) => sum + cardMoneyValue(cardId), 0);
    const payableTotal = totalPayableValue(payer);
    if (payableTotal >= req.amount && total < req.amount) {
      return setErr(error('invalid_action', `Payment must total at least $${req.amount}.`));
    }
    if (payableTotal < req.amount && total < payableTotal) {
      return setErr(error('invalid_action', 'Player must pay all available cards when total funds are insufficient.'));
    }

    for (const cardId of selected) {
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
    pushEvent(events, 'pay', `${payer.name} paid ${collector.name} $${Math.min(total, req.amount)} (${req.reason}).`);
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
    pushEvent(events, 'sly_deal', `${source.name} took ${cardLabel(action.cardId)} from ${target.name}.`, {
      kind: 'property_steal',
      sourcePlayerId: source.id,
      targetPlayerId: target.id,
      cardIds: [action.cardId],
      mode: 'sly_deal',
    });
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
    pushEvent(events, 'forced_deal', `${source.name} swapped ${cardLabel(action.giveCardId)} for ${cardLabel(action.takeCardId)}.`, {
      kind: 'property_steal',
      sourcePlayerId: source.id,
      targetPlayerId: target.id,
      cardIds: [action.giveCardId, action.takeCardId],
      mode: 'forced_deal',
    });
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
    pushEvent(events, 'deal_breaker', `${source.name} stole ${target.name}'s ${action.color} set.`, {
      kind: 'property_steal',
      sourcePlayerId: source.id,
      targetPlayerId: target.id,
      cardIds: cards.map((entry) => entry.cardId),
      mode: 'deal_breaker',
    });
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
  const winner = state.players.find((player) => countCompleteSets(player) >= ruleset(state).winCompleteSets);
  return winner ? { done: true, winnerId: winner.id } : { done: false };
}

function playerName(state: GameState, playerId: PlayerId, fallback: string): string {
  return getPlayer(state, playerId)?.name ?? fallback;
}

export function getNextPrompt(state: GameState): TurnPrompt {
  const currentPlayer = getCurrentPlayer(state);
  if (requiresEndTurnDiscard(state, currentPlayer)) {
    return {
      playerId: currentPlayer.id,
      text: `${currentPlayer.name}: discard down to ${ruleset(state).maxHandAtEndTurn} cards to end your turn.`,
      kind: 'discard',
    };
  }

  if (state.pending?.kind === 'counter') {
    const pendingPlayer = getPlayer(state, state.pending.payload.awaitingPlayerId);
    const sourceName = playerName(state, state.pending.payload.sourcePlayerId, 'Player');
    const actionCardName = cardLabel(state.pending.payload.actionCardId);
    return {
      playerId: pendingPlayer?.id ?? currentPlayer.id,
      text: `${pendingPlayer?.name ?? 'Player'}: respond to ${sourceName}'s ${actionCardName} with Just Say No or resolve.`,
      kind: 'response',
    };
  }

  if (state.pending?.kind === 'payment') {
    const pendingPlayer = getPlayer(state, state.pending.payload.targetPlayerId);
    const sourceName = playerName(state, state.pending.payload.sourcePlayerId, 'Player');
    return {
      playerId: pendingPlayer?.id ?? currentPlayer.id,
      text: `${pendingPlayer?.name ?? 'Player'}: pay ${sourceName} $${state.pending.payload.amount} for ${state.pending.payload.reason}.`,
      kind: 'payment',
    };
  }

  if (state.pending?.kind === 'rent') {
    const sourceName = playerName(state, state.pending.payload.sourcePlayerId, 'Player');
    return {
      playerId: state.pending.payload.sourcePlayerId,
      text: `${sourceName}: choose who pays $${state.pending.payload.amount} rent for ${colorLabel(state.pending.payload.color)}.`,
      kind: 'selection',
    };
  }

  if (state.pending?.kind === 'sly_deal') {
    const sourceName = playerName(state, state.pending.payload.sourcePlayerId, 'Player');
    const targetName = playerName(state, state.pending.payload.targetPlayerId, 'target');
    return {
      playerId: state.pending.payload.sourcePlayerId,
      text: `${sourceName}: choose a property card to steal from ${targetName}.`,
      kind: 'selection',
    };
  }

  if (state.pending?.kind === 'forced_deal') {
    const sourceName = playerName(state, state.pending.payload.sourcePlayerId, 'Player');
    const targetName = playerName(state, state.pending.payload.targetPlayerId, 'target');
    return {
      playerId: state.pending.payload.sourcePlayerId,
      text: `${sourceName}: choose one of your properties, then a property from ${targetName} to swap.`,
      kind: 'selection',
    };
  }

  if (state.pending?.kind === 'deal_breaker') {
    const sourceName = playerName(state, state.pending.payload.sourcePlayerId, 'Player');
    const targetName = playerName(state, state.pending.payload.targetPlayerId, 'target');
    return {
      playerId: state.pending.payload.sourcePlayerId,
      text: `${sourceName}: choose a complete set to steal from ${targetName}.`,
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
    text: `${currentPlayer.name}: play up to ${ruleset(state).maxPlaysPerTurn - state.turn.playsUsed} cards or pass.`,
    kind: 'main',
  };
}

export function getSetCompletionCount(player: PlayerState): number {
  return countCompleteSets(player);
}
