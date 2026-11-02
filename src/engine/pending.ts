import { getCardDefinition, PROPERTY_SET_SIZES, type PropertyColor } from '../cards/catalog';
import type {
  GameEvent,
  GameState,
  LegalAction,
  PendingEffect,
  PlayerId,
  PlayerState,
  RuleError,
} from './types';
import {
  PROPERTY_COLORS,
  canCardBePlacedInColor,
  cardLabel,
  colorLabel,
  completeSetColors,
  generatePaymentOptions,
  suggestPayment,
  getPlayer,
  isCompleteSet,
  movablePropertyCards,
  propertySets,
  pushEvent,
  totalBankValue,
  totalPayableValue,
} from './core';

export function resolveEffect(state: GameState, effect: PendingEffect, events: GameEvent[]): RuleError | undefined {
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
  if (effect.kind === 'no_mercy') {
    state.pending = { kind: 'no_mercy', payload: effect.payload };
    return undefined;
  }
  pushEvent(events, 'noop', 'No effect resolved.');
  return undefined;
}

export function maybeOpenCounter(
  state: GameState,
  sourcePlayerId: PlayerId,
  targetPlayerId: PlayerId,
  actionCardId: string,
  effect: PendingEffect,
): boolean {
  const target = getPlayer(state, targetPlayerId);
  if (!target) return false;
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

export function continuePaymentChain(
  state: GameState,
  request: {
    sourcePlayerId: PlayerId;
    amount: number;
    reason: string;
    actionCardId: string;
    remainingTargetPlayerIds?: PlayerId[];
  },
  events: GameEvent[],
): void {
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

function legalForCounter(state: GameState, player: PlayerState): LegalAction[] {
  if (!state.pending || state.pending.kind !== 'counter') return [];
  const req = state.pending.payload;
  if (req.awaitingPlayerId !== player.id) return [];
  const variant = state.variant ?? 'classic';
  const jsn = player.hand.filter((cardId) => getCardDefinition(cardId, variant).actionKind === 'just_say_no');
  const actions: LegalAction[] = [
    {
      label: 'Resolve without Just Say No',
      action: { type: 'counter_response', playerId: player.id, useJustSayNo: false },
    },
  ];
  for (const cardId of jsn) {
    actions.push({
      label: `Play Just Say No (${cardLabel(cardId, variant)})`,
      action: { type: 'counter_response', playerId: player.id, useJustSayNo: true, cardId },
    });
  }
  return actions;
}

function legalForPayment(state: GameState, player: PlayerState): LegalAction[] {
  if (!state.pending || state.pending.kind !== 'payment') return [];
  if (state.pending.payload.targetPlayerId !== player.id) return [];
  const variant = state.variant ?? 'classic';
  const paymentOptions = generatePaymentOptions(player, state.pending.payload.amount, variant);
  // The list is capped by how little each option overpays, which can leave out the sensible one.
  const suggested = suggestPayment(player, state.pending.payload.amount, variant).sort((left, right) => left.localeCompare(right));
  if (suggested.length > 0 && !paymentOptions.some((cards) => cards.join('|') === suggested.join('|'))) paymentOptions.push(suggested);
  return paymentOptions.map((cards, idx) => ({
    label: cards.length
      ? `Pay option ${idx + 1}: ${cards.map((cardId) => cardLabel(cardId, state.variant ?? 'classic')).join(', ')}`
      : 'Cannot pay (no cards)',
    action: { type: 'pay_request', playerId: player.id, cards },
  }));
}

function legalForRentSelection(state: GameState, player: PlayerState): LegalAction[] {
  if (!state.pending || state.pending.kind !== 'rent') return [];
  const req = state.pending.payload;
  if (req.sourcePlayerId !== player.id) return [];

  const actions: LegalAction[] = [];
  for (const target of state.players) {
    if (target.id === player.id) continue;
    const requestedAmount = req.amount;
    const variant = state.variant ?? 'classic';
    const collectibleCap = Math.min(requestedAmount, totalPayableValue(target, variant));
    const requiresPropertyTransfer = collectibleCap > totalBankValue(target, variant);
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

function legalForSlyDealSelection(state: GameState, player: PlayerState): LegalAction[] {
  if (!state.pending || state.pending.kind !== 'sly_deal') return [];
  const req = state.pending.payload;
  if (req.sourcePlayerId !== player.id) return [];
  const target = getPlayer(state, req.targetPlayerId);
  if (!target) return [];
  const variant = state.variant ?? 'classic';

  const choices: LegalAction[] = [];
  for (const movable of movablePropertyCards(target, variant)) {
    const def = getCardDefinition(movable.cardId, state.variant ?? 'classic');
    for (const destColor of PROPERTY_COLORS.filter((candidate) => canCardBePlacedInColor(def, candidate))) {
      const setIds = openSetIds(player, destColor, variant);
      for (const setId of setIds) {
        choices.push({
          label: `Take ${cardLabel(movable.cardId, variant)} from ${target.name} to ${colorLabel(destColor)}`,
          action: {
            type: 'sly_deal_pick',
            playerId: player.id,
            cardId: movable.cardId,
            sourceColor: movable.color,
            destinationColor: destColor,
            sourceSetId: movable.setId,
            setId,
          },
        });
      }
    }
  }
  return choices;
}

function legalForForcedDealSelection(state: GameState, player: PlayerState): LegalAction[] {
  if (!state.pending || state.pending.kind !== 'forced_deal') return [];
  const req = state.pending.payload;
  if (req.sourcePlayerId !== player.id) return [];
  const source = getPlayer(state, req.sourcePlayerId);
  const target = getPlayer(state, req.targetPlayerId);
  if (!source || !target) return [];

  const actions: LegalAction[] = [];
  const variant = state.variant ?? 'classic';
  for (const own of movablePropertyCards(source, variant)) {
    for (const theirs of movablePropertyCards(target, variant)) {
      const takenCard = getCardDefinition(theirs.cardId, state.variant ?? 'classic');
      for (const destColor of PROPERTY_COLORS.filter((candidate) => canCardBePlacedInColor(takenCard, candidate))) {
        const setIds = openSetIds(source, destColor, variant);
        for (const setId of setIds) {
          actions.push({
            label: `Swap ${cardLabel(own.cardId, variant)} for ${cardLabel(theirs.cardId, variant)}`,
            action: {
              type: 'forced_deal_pick',
              playerId: player.id,
              giveCardId: own.cardId,
              giveColor: own.color,
              takeCardId: theirs.cardId,
              takeColor: theirs.color,
              destinationColor: destColor,
              giveSetId: own.setId,
              takeSetId: theirs.setId,
              setId,
            },
          });
        }
      }
    }
  }
  return actions;
}

function legalForDealBreakerSelection(state: GameState, player: PlayerState): LegalAction[] {
  if (!state.pending || state.pending.kind !== 'deal_breaker') return [];
  const req = state.pending.payload;
  if (req.sourcePlayerId !== player.id) return [];
  const target = getPlayer(state, req.targetPlayerId);
  if (!target) return [];

  const variant = state.variant ?? 'classic';
  return completeSetColors(target, variant).flatMap((color) => propertySets(target, color, variant)
    .filter((set) => isCompleteSet(target, color, set.setId, variant))
    .map((set) => ({
      label: `Take complete ${colorLabel(color)} set`,
      action: { type: 'deal_breaker_pick', playerId: player.id, color, setId: set.setId },
    })));
}

function openSetIds(player: PlayerState, color: PropertyColor, variant: 'classic' | 'no_mercy' = 'classic'): Array<string | undefined> {
  const open = propertySets(player, color, variant).filter((set) => {
    const count = set.entries.filter((entry) => {
      const kind = getCardDefinition(entry.cardId, variant).kind;
      return kind === 'property' || kind === 'wild';
    }).length;
    return count < PROPERTY_SET_SIZES[color] && !isCompleteSet(player, color, set.setId, variant);
  });
  return open.length > 0 ? open.map((set) => set.setId) : [undefined];
}

export function legalForPending(state: GameState, player: PlayerState): LegalAction[] {
  if (!state.pending) return [];

  if (state.pending.kind === 'counter') return legalForCounter(state, player);
  if (state.pending.kind === 'payment') return legalForPayment(state, player);
  if (state.pending.kind === 'rent') return legalForRentSelection(state, player);
  if (state.pending.kind === 'sly_deal') return legalForSlyDealSelection(state, player);
  if (state.pending.kind === 'forced_deal') return legalForForcedDealSelection(state, player);
  if (state.pending.kind === 'deal_breaker') return legalForDealBreakerSelection(state, player);

  return [];
}
