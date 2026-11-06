import { getCardCatalog, getCardDefinition, isEveryColorWild, type ActionKind, type GameVariant, type PropertyColor } from '../cards/catalog';
import type {
  Action,
  ApplyResult,
  GameConfig,
  GameEvent,
  GameState,
  LegalAction,
  PendingEffect,
  PendingNoMercy,
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
  allocatePropertySetId,
  addToProperty,
  attachedPropertyCards,
  canCardBeBanked,
  canCardBePlacedInColor,
  canPlayDoubleRent,
  cardLabel,
  cardMoneyValue,
  checkWinner,
  suggestPayment,
  cloneState,
  colorLabel,
  completeSetColors,
  consumePlay,
  countCompleteSets,
  discard,
  discardableCards,
  drawCards,
  error,
  findPropertyColorByCard,
  findPropertySetIdByCard,
  finishTurn,
  gameVariant,
  getCurrentPlayer,
  getPlayer,
  getRentAmount,
  isBuildingPlacementLegal,
  isShackPlacementLegal,
  initialProperties,
  isCompleteSet,
  movablePropertyCards,
  normalizePropertySets,
  now,
  pushEvent,
  propertySets,
  removeFromHand,
  removePropertyCard,
  requiresEndTurnDiscard,
  rngFromSeed,
  ruleset,
  shuffle,
  totalPayableValue,
} from './core';
import {
  continuePaymentChain,
  legalForPending,
  maybeOpenCounter,
  resolveEffect,
} from './pending';

export { DEFAULT_RULESET, MAX_HAND_AT_END_TURN };

function cardDefinition(state: GameState, cardId: string) {
  return getCardDefinition(cardId, gameVariant(state));
}

function completeSet(state: GameState, player: PlayerState, color: PropertyColor, setId?: string): boolean {
  return isCompleteSet(player, color, setId, gameVariant(state));
}

export function getSuggestedPaymentCards(state: GameState, playerId: PlayerId, amount: number): string[] {
  const player = getPlayer(state, playerId);
  if (!player) return [];
  return suggestPayment(player, amount, gameVariant(state));
}

function debtsFor(player: PlayerState): NonNullable<PlayerState['debts']> {
  const debts = (player.debtsOwed && player.debtsOwed.length > 0 && (!player.debts || player.debts.length === 0))
    ? player.debtsOwed : (player.debts ?? player.debtsOwed ?? []);
  player.debts = debts;
  player.debtsOwed = debts;
  return debts;
}

function nextChipId(player: PlayerState): string {
  const used = new Set(debtsFor(player).map((debt) => debt.chipId ?? debt.id));
  let index = 1;
  while (used.has(`${player.id}-chip-${index}`)) index += 1;
  return `${player.id}-chip-${index}`;
}

function issueDebt(state: GameState, debtor: PlayerState, creditor: PlayerState, amount: number): boolean {
  if (gameVariant(state) !== 'no_mercy') return false;
  const remaining = Math.min(debtor.debtChipsRemaining ?? 3, Math.max(0, 3 - debtsFor(debtor).length));
  if (remaining <= 0) return false;
  const chipId = nextChipId(debtor);
  const record = { id: chipId, chipId, debtorPlayerId: debtor.id, creditorPlayerId: creditor.id, amount, createdTurn: state.turnCount };
  debtsFor(debtor).push(record);
  creditor.debtChipsHeld = creditor.debtChipsHeld ?? creditor.debtChips ?? [];
  creditor.debtChips = creditor.debtChipsHeld;
  creditor.debtChipsHeld.push(record);
  debtor.debtChipsRemaining = remaining - 1;
  return true;
}

function canIssueDebt(state: GameState, debtor: PlayerState): boolean {
  if (gameVariant(state) !== 'no_mercy') return false;
  return (debtor.debtChipsRemaining ?? 3) > 0 && debtsFor(debtor).length < 3;
}

function legalDebtActions(state: GameState, player: PlayerState): LegalAction[] {
  if (gameVariant(state) !== 'no_mercy' || state.turn.phase !== 'debt' || getCurrentPlayer(state).id !== player.id) return [];
  if (state.turn.playsUsed >= ruleset(state).maxPlaysPerTurn) return [];
  return debtsFor(player).flatMap((debt) => player.hand.map((cardId) => ({
    label: `Repay ${playerNameFor(state, debt.creditorPlayerId)} with ${cardLabel(cardId, gameVariant(state))}`,
    action: { type: 'repay_debt' as const, playerId: player.id, debtId: debt.id ?? debt.chipId, cardId },
  })));
}

/**
 * Cancel every debt to or from a player leaving the match, while they are still
 * in `state.players`. A debt to someone who is gone can never be repaid, and its
 * repayment would be the debtor's only legal action.
 */
export function releaseDebtsInvolving(state: GameState, playerId: PlayerId): void {
  if (gameVariant(state) !== 'no_mercy') return;
  const leaving = getPlayer(state, playerId);
  if (!leaving) return;
  const leavingChipIds = new Set(debtsFor(leaving).map((debt) => debt.chipId ?? debt.id));
  for (const player of state.players) {
    const owed = debtsFor(player);
    const kept = owed.filter((debt) => debt.creditorPlayerId !== playerId);
    player.debts = kept;
    player.debtsOwed = kept;
    player.debtChipsRemaining = Math.min(3, (player.debtChipsRemaining ?? 0) + owed.length - kept.length);
    const held = (player.debtChipsHeld ?? player.debtChips ?? []).filter((chip) => !leavingChipIds.has(chip.chipId ?? chip.id));
    player.debtChipsHeld = held;
    player.debtChips = held;
  }
}

/**
 * Leave the debt phase once nothing more can be repaid this turn. A debt that
 * is still owed carries over; staying in the phase would leave the player with
 * no legal action at all.
 */
export function settleDebtPhase(state: GameState): void {
  if (gameVariant(state) !== 'no_mercy' || state.turn.phase !== 'debt' || state.pending) return;
  const current = getCurrentPlayer(state);
  if (debtsFor(current).length === 0
    || current.hand.length === 0
    || state.turn.playsUsed >= ruleset(state).maxPlaysPerTurn) {
    state.turn.phase = 'action';
  }
}

/**
 * A debt card is resolved immediately by its creditor. Build a temporary
 * action window for that player so the normal legal-action generator remains
 * the single source of truth for target and color choices, without changing
 * the debtor's turn or play budget.
 */
function receivedActionChoices(state: GameState, recipient: PlayerState, cardId: string): Extract<Action, { type: 'play_action' }>[] {
  const temporary = cloneState(state);
  temporary.pending = null;
  temporary.currentPlayerIndex = temporary.players.findIndex((candidate) => candidate.id === recipient.id);
  temporary.turn = { phase: 'action', playsUsed: 0, doubleRentMultiplier: 1, endingTurn: false };
  const temporaryRecipient = getPlayer(temporary, recipient.id);
  if (!temporaryRecipient) return [];
  temporaryRecipient.hand.push(cardId);
  return getLegalActions(temporary, recipient.id)
    .map((entry) => entry.action)
    .filter((candidate): candidate is Extract<Action, { type: 'play_action' }> => candidate.type === 'play_action' && candidate.cardId === cardId);
}

function legalDebtCardActions(state: GameState, player: PlayerState): LegalAction[] {
  if (state.pending?.kind !== 'debt_card' || state.pending.payload.creditorPlayerId !== player.id) return [];
  const card = cardDefinition(state, state.pending.payload.cardId);
  if (card.kind === 'action' || card.kind === 'building' || card.kind === 'money') {
    const debtCardId = cardIdFromPending(state);
    const actions: LegalAction[] = [{
      label: `Bank ${card.name}`,
      action: { type: 'resolve_debt_card', playerId: player.id, debtId: state.pending.payload.debtId, cardId: debtCardId, mode: 'bank' },
    }];
    // Go Again explicitly goes to the Bank when received as debt payment.
    if (card.kind === 'action' && card.actionKind !== 'go_again') {
      for (const choice of receivedActionChoices(state, player, debtCardId)) {
        actions.push({
          label: `Play received ${card.name}${choice.targetPlayerId ? ` on ${playerNameFor(state, choice.targetPlayerId)}` : choice.color ? ` for ${colorLabel(choice.color)} rent` : ''}`,
          action: {
            type: 'resolve_debt_card',
            playerId: player.id,
            debtId: state.pending.payload.debtId,
            cardId: debtCardId,
            mode: 'action',
            targetPlayerId: choice.targetPlayerId,
            color: choice.color,
          },
        });
      }
    }
    return actions;
  }
  const debtCard = state.pending.payload;
  return PROPERTY_COLORS.filter((color) => canCardBePlacedInColor(card, color)).map((color) => ({
    label: `Place ${card.name} in ${colorLabel(color)}`,
    action: { type: 'resolve_debt_card' as const, playerId: player.id, debtId: debtCard.debtId, cardId: debtCard.cardId, mode: 'property' as const, color },
  }));
}

function cardIdFromPending(state: GameState): string {
  return state.pending?.kind === 'debt_card' ? state.pending.payload.cardId : '';
}

function playerNameFor(state: GameState, id: string): string {
  return getPlayer(state, id)?.name ?? 'Player';
}

/** Resolve deterministic, server-authoritative No Mercy global effects. */
function progressNoMercy(state: GameState, events: GameEvent[]): void {
  if (state.pending?.kind !== 'no_mercy') return;
  const req = state.pending.payload;
  const variant = gameVariant(state);
  const source = getPlayer(state, req.sourcePlayerId);
  if (!source) { state.pending = null; return; }

  if (req.effect === 'forced_debt') {
    const debtor = req.targetPlayerId ? getPlayer(state, req.targetPlayerId) : undefined;
    if (debtor) issueDebt(state, debtor, source, 1);
    state.pending = null;
    return;
  }

  if (req.effect === 'heist' || req.effect === 'market_crash') {
    const remaining = [...(req.targetPlayerIds ?? [])];
    const next = remaining[0];
    const target = next ? getPlayer(state, next) : undefined;
    if (!target) { state.pending = null; return; }
    const available = req.effect === 'heist'
      ? target.bank.map((cardId) => ({ cardId, color: undefined as PropertyColor | undefined }))
      : PROPERTY_COLORS.flatMap((color) => (target.properties[color] ?? [])
        .filter((entry) => ['property', 'wild'].includes(cardDefinition(state, entry.cardId).kind))
        .map((entry) => ({ cardId: entry.cardId, color, setId: entry.setId })));
    if (available.length === 0) {
      remaining.shift();
      state.pending = remaining.length > 0 ? { kind: 'no_mercy', payload: { ...req, targetPlayerIds: remaining } } : null;
      if (state.pending) progressNoMercy(state, events);
      return;
    }
    state.pending = {
      kind: 'no_mercy',
      payload: { ...req, step: req.effect === 'heist' ? 'heist_pick' : 'market_crash_pick', targetPlayerId: target.id },
    };
    return;
  }

  if (req.effect === 'super_sly_deal') {
    const remaining = [...(req.targetPlayerIds ?? [])];
    const next = remaining.shift();
    const target = next ? getPlayer(state, next) : undefined;
    if (!target || !req.color) { state.pending = null; return; }
    const matches = PROPERTY_COLORS.flatMap((color) => (target.properties[color] ?? [])
      .filter((entry) => {
        const def = cardDefinition(state, entry.cardId);
        return (def.kind === 'property' && def.color === req.color)
          || (def.kind === 'wild' && (def.colors ?? []).includes(req.color!));
      })
      .map((entry) => ({ color, entry })));
    for (const item of matches) {
      const removed = removePropertyCard(target, item.color, item.entry.cardId, item.entry.setId);
      if (removed) {
        addToProperty(source, removed.cardId, item.color, undefined, removed.attachedToCardId, variant);
        const destinationSetId = findPropertySetIdByCard(source, item.color, removed.cardId, variant);
        for (const attachment of attachedPropertyCards(target, item.color, item.entry.cardId, item.entry.setId)) {
          removePropertyCard(target, item.color, attachment.cardId, item.entry.setId);
          addToProperty(source, attachment.cardId, item.color, destinationSetId, attachment.attachedToCardId, variant);
        }
      }
    }
    if (remaining.length === 0) { state.pending = null; return; }
    const effect: PendingEffect = { kind: 'no_mercy', payload: { ...req, targetPlayerIds: remaining, step: undefined, targetPlayerId: undefined } };
    state.pending = null;
    if (!maybeOpenCounter(state, source.id, remaining[0], req.actionCardId, effect)) resolveEffect(state, effect, events);
    return;
  }

  if (req.effect === 'repossession' || req.effect === 'tax_collector' || req.effect === 'tough_luck') {
    const target = req.targetPlayerId ? getPlayer(state, req.targetPlayerId) : undefined;
    if (!target) { state.pending = null; return; }
    if (req.effect === 'repossession') {
      if (req.step === 'repossession_distribute') return;
      const hasProperty = PROPERTY_COLORS.some((color) => target.properties[color].some((entry) => {
        const def = cardDefinition(state, entry.cardId);
        return def.kind === 'property' || def.kind === 'wild';
      }));
      if (!hasProperty) state.pending = null;
      else if (req.step !== 'repossession_keep') state.pending = { kind: 'no_mercy', payload: { ...req, step: 'repossession_keep' } };
      return;
    }
    if (req.effect === 'tax_collector') {
      if (req.step === 'tax_collector_distribute') return;
      if (target.bank.length <= 1) state.pending = null;
      else if (req.step !== 'tax_collector_keep') state.pending = { kind: 'no_mercy', payload: { ...req, step: 'tax_collector_keep' } };
      return;
    }
    if (req.step !== 'tough_luck_choice') state.pending = { kind: 'no_mercy', payload: { ...req, step: 'tough_luck_choice' } };
    return;
  }

  if (req.effect === 'unfair_trade') {
    const target = req.targetPlayerId ? getPlayer(state, req.targetPlayerId) : undefined;
    if (target && source.bank.length > 0) {
      const own = [...source.bank];
      source.bank = [...target.bank];
      target.bank = own;
    }
    state.pending = null;
    return;
  }

  state.pending = null;
}

function legalNoMercyActions(state: GameState, player: PlayerState): LegalAction[] {
  if (state.pending?.kind !== 'no_mercy') return [];
  const req = state.pending.payload;
  const variant = gameVariant(state);
  const target = req.targetPlayerId ? getPlayer(state, req.targetPlayerId) : undefined;
  const actions: LegalAction[] = [];
  if (req.effect === 'heist' && req.step === 'heist_pick' && req.sourcePlayerId === player.id && target) {
    for (const cardId of target.bank) actions.push({
      label: `Heist ${cardLabel(cardId, variant)} from ${target.name}`,
      action: { type: 'no_mercy_pick', playerId: player.id, actionCardId: req.actionCardId, targetPlayerId: target.id, cardId },
    });
  }
  if (req.effect === 'market_crash' && req.step === 'market_crash_pick' && req.sourcePlayerId === player.id && target) {
    for (const color of PROPERTY_COLORS) for (const entry of target.properties[color]) {
      const def = cardDefinition(state, entry.cardId);
      if (def.kind !== 'property' && def.kind !== 'wild') continue;
      actions.push({
        label: `Take ${cardLabel(entry.cardId, variant)} from ${target.name}`,
        action: { type: 'no_mercy_pick', playerId: player.id, actionCardId: req.actionCardId, targetPlayerId: target.id, cardId: entry.cardId, color },
      });
    }
  }
  if (req.effect === 'repossession' && req.step === 'repossession_keep' && target?.id === player.id) {
    for (const color of PROPERTY_COLORS) for (const entry of target.properties[color]) {
      const def = cardDefinition(state, entry.cardId);
      if (def.kind !== 'property' && def.kind !== 'wild') continue;
      actions.push({
        label: `Keep ${cardLabel(entry.cardId, variant)}`,
        action: { type: 'no_mercy_pick', playerId: player.id, actionCardId: req.actionCardId, targetPlayerId: target.id, cardId: entry.cardId, color },
      });
    }
  }
  if ((req.effect === 'repossession' && req.step === 'repossession_distribute')
    || (req.effect === 'tax_collector' && req.step === 'tax_collector_distribute')) {
    if (target?.id !== player.id || !req.redistribution?.length) return actions;
    const card = req.redistribution[0];
    for (const recipient of state.players) if (recipient.id !== target.id) actions.push({
      label: `Give ${cardLabel(card.cardId, variant)} to ${recipient.name}`,
      action: { type: 'no_mercy_pick', playerId: player.id, actionCardId: req.actionCardId, targetPlayerId: target.id, cardId: card.cardId, recipientPlayerId: recipient.id },
    });
  }
  if (req.effect === 'tax_collector' && req.step === 'tax_collector_keep' && target?.id === player.id) {
    for (const cardId of target.bank) actions.push({
      label: `Keep ${cardLabel(cardId, variant)}`,
      action: { type: 'no_mercy_pick', playerId: player.id, actionCardId: req.actionCardId, targetPlayerId: target.id, cardId },
    });
  }
  if (req.effect === 'tough_luck' && req.step === 'tough_luck_choice' && req.sourcePlayerId === player.id) {
    for (const choice of ['property', 'money', 'action'] as const) actions.push({
      label: `Take all ${choice} cards from ${target?.name ?? 'target'}'s hand`,
      action: { type: 'no_mercy_pick', playerId: player.id, actionCardId: req.actionCardId, targetPlayerId: target?.id, choice },
    });
  }
  return actions;
}

function legalPlayActions(state: GameState, player: PlayerState): LegalAction[] {
  const actions: LegalAction[] = [];
  if (state.turn.phase !== 'action') return actions;
  const canUsePlay = state.turn.playsUsed < ruleset(state).maxPlaysPerTurn;
  const variant = gameVariant(state);

  if (canUsePlay) {
    for (const cardId of player.hand) {
      const card = cardDefinition(state, cardId);

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
        if (variant === 'no_mercy' && card.actionKind === 'shack') {
          for (const color of PROPERTY_COLORS) {
            for (const set of propertySets(player, color, variant)) {
              for (const entry of set.entries) {
                const entryDef = cardDefinition(state, entry.cardId);
                if (entryDef.kind !== 'property' && entryDef.kind !== 'wild') continue;
                if (!isShackPlacementLegal(player, color, set.setId, entry.cardId, variant)) continue;
                actions.push({
                  label: `Play Shack on ${colorLabel(color)} property`,
                  action: { type: 'play_property', playerId: player.id, cardId, color, setId: set.setId, attachedToCardId: entry.cardId },
                });
              }
            }
          }
          continue;
        }
        for (const color of PROPERTY_COLORS) {
          const eligibleSetIds = propertySets(player, color, variant)
            .filter((set) => isBuildingPlacementLegal(player, color, card.actionKind as 'house' | 'hotel', set.setId, variant))
            .map((set) => set.setId);
          for (const setId of eligibleSetIds) {
            actions.push({
              label: eligibleSetIds.length > 1
                ? `Play ${card.name} on ${colorLabel(color)} set ${setId}`
                : `Play ${card.name} on ${colorLabel(color)}`,
              action: {
                type: 'play_property',
                playerId: player.id,
                cardId,
                color,
                ...(eligibleSetIds.length > 1 ? { setId } : {}),
              },
            });
          }
        }
      }

      if (card.kind === 'action') {
        const actionKind = card.actionKind as ActionKind;
        if (actionKind === 'just_say_no') continue;

        if (variant === 'no_mercy' && (actionKind === 'go_again' || actionKind === 'heist' || actionKind === 'market_crash')) {
          actions.push({ label: `Play ${card.name}`, action: { type: 'play_action', playerId: player.id, cardId } });
          continue;
        }

        if (variant === 'no_mercy' && actionKind === 'super_sly_deal') {
          const colors = PROPERTY_COLORS.filter((color) => state.players.some((target) => target.id !== player.id
            && target.properties[color].some((entry) => {
              const def = cardDefinition(state, entry.cardId);
              return (def.kind === 'property' && def.color === color)
                || (def.kind === 'wild' && (def.colors ?? []).includes(color));
            })));
          for (const color of colors) actions.push({
            label: `Play ${card.name} for ${colorLabel(color)}`,
            action: { type: 'play_action', playerId: player.id, cardId, color },
            requiresConfirmation: true,
            targetPlayerId: undefined,
            riskLevel: 'high',
            previewText: `Take every ${colorLabel(color)} property from all opponents, including complete sets.`,
          });
          continue;
        }

        if (variant === 'no_mercy' && ['forced_debt', 'repossession', 'tax_collector', 'tough_luck', 'unfair_trade', 'yoink'].includes(actionKind)) {
          if (actionKind === 'unfair_trade' && player.bank.length === 0) continue;
          for (const target of state.players) if (target.id !== player.id
            && (actionKind !== 'forced_debt' || canIssueDebt(state, target))) actions.push({
            label: `Play ${card.name} on ${target.name}`,
            action: { type: 'play_action', playerId: player.id, cardId, targetPlayerId: target.id },
            targetPlayerId: target.id,
          });
          continue;
        }

        if (actionKind === 'pass_go' || actionKind === 'its_my_birthday') {
          actions.push({
            label: `Play ${card.name}`,
            action: { type: 'play_action', playerId: player.id, cardId },
          });
          continue;
        }

        if (actionKind === 'double_rent') {
          if (variant === 'no_mercy') {
            const allowedColors = Object.keys(card.rentMatrix ?? {}) as PropertyColor[];
            for (const color of allowedColors) {
              if (getRentAmount(player, color, variant) <= 0) continue;
              actions.push({
                label: `Play ${card.name} for ${colorLabel(color)} rent`,
                action: { type: 'play_action', playerId: player.id, cardId, color },
                requiresConfirmation: true,
                riskLevel: 'high',
                previewText: `Charge all opponents double ${colorLabel(color)} rent.`,
              });
            }
          } else if (canPlayDoubleRent(state, player, cardId)) {
            actions.push({
              label: `Play ${card.name}`,
              action: { type: 'play_action', playerId: player.id, cardId },
            });
          }
          continue;
        }

        if (actionKind === 'debt_collector' || actionKind === 'sly_deal' || actionKind === 'forced_deal' || actionKind === 'deal_breaker') {
          const ownMovableCards = movablePropertyCards(player, variant);
          for (const target of state.players) {
            if (target.id === player.id) continue;
            if (actionKind === 'sly_deal' && movablePropertyCards(target, variant).length === 0) continue;
            if (actionKind === 'forced_deal' && (ownMovableCards.length === 0 || movablePropertyCards(target, variant).length === 0)) continue;
            if (actionKind === 'deal_breaker' && completeSetColors(target, variant).length === 0) continue;
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
            if (getRentAmount(player, color, variant) <= 0) continue;
            actions.push({
              label: `Play ${card.name} for ${colorLabel(color)} rent`,
              action: { type: 'play_action', playerId: player.id, cardId, color },
              requiresConfirmation: true,
              riskLevel: 'medium',
              previewText: variant === 'no_mercy' || actionKind === 'rent_wild'
                ? `Charge all opponents for ${colorLabel(color)} rent.`
                : `Charge one opponent for ${colorLabel(color)} rent.`,
            });
          }
        }
      }
    }
  }

  for (const color of PROPERTY_COLORS) {
    for (const placement of player.properties[color]) {
      const def = cardDefinition(state, placement.cardId);
      if (def.kind !== 'wild') continue;
      // A Shack is physically attached to its property and cannot be moved
      // independently by the Wild's free color-change action.
      if (variant === 'no_mercy' && attachedPropertyCards(player, color, placement.cardId, placement.setId).length > 0) continue;
      for (const targetColor of PROPERTY_COLORS.filter((candidate) => canCardBePlacedInColor(def, candidate) && candidate !== color)) {
        const openSets = propertySets(player, targetColor, variant).filter((set) => !completeSet(state, player, targetColor, set.setId));
        const targetSetIds = openSets.length > 0 ? openSets.map((set) => set.setId) : [undefined];
        for (const setId of targetSetIds) {
          actions.push({
            label: `Move ${cardLabel(placement.cardId, variant)} from ${colorLabel(color)} to ${colorLabel(targetColor)}`,
            action: {
              type: 'move_wild',
              playerId: player.id,
              cardId: placement.cardId,
              fromColor: color,
              toColor: targetColor,
              fromSetId: placement.setId,
              setId,
            },
          });
        }
      }
    }
  }

  actions.push({ label: 'Pass turn', action: { type: 'pass_turn', playerId: player.id } });

  return actions;
}

export function createGame(config: GameConfig): GameState {
  if (config.players.length < 2 || config.players.length > 5) {
    throw new Error('Monopoly Deal supports 2-5 players.');
  }

  const variant: GameVariant = config.variant === 'no_mercy' ? 'no_mercy' : 'classic';
  const ruleset: RulesetV1 = {
    ...DEFAULT_RULESET,
    ...(variant === 'classic' ? config.ruleset : {}),
  };
  const seed = config.seed ?? Math.floor(Math.random() * 1_000_000_000);
  const rand = rngFromSeed(seed);

  const deck: string[] = [];
  for (const card of getCardCatalog(variant).definitions) {
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
    ...(variant === 'no_mercy' ? { debts: [], debtsOwed: [], debtChipsRemaining: 3, debtChipsHeld: [], debtChips: [] } : {}),
  }));

  const state: GameState = {
    version: 1,
    createdAt: now(),
    updatedAt: now(),
    deckVersion: 'v1',
    variant,
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
    return discardableCards(state, player).map((cardId) => ({
      label: `Discard ${cardLabel(cardId, gameVariant(state))}`,
      action: { type: 'discard_card', playerId, cardId },
    }));
  }

  const pendingActions = legalForPending(state, player);
  if (pendingActions.length > 0) return pendingActions;
  const debtCardActions = legalDebtCardActions(state, player);
  if (debtCardActions.length > 0) return debtCardActions;
  const noMercyActions = legalNoMercyActions(state, player);
  if (noMercyActions.length > 0) return noMercyActions;
  if (state.pending) return [];

  const current = getCurrentPlayer(state);
  if (current.id !== playerId) return [];

  if (state.turn.phase === 'draw') {
    return [{ label: 'Draw cards', action: { type: 'draw_cards', playerId } }];
  }

  if (state.turn.phase === 'debt') return legalDebtActions(state, player);

  if (state.turn.phase === 'action') {
    return legalPlayActions(state, player);
  }

  return [];
}

export function applyAction(currentState: GameState, action: Action): ApplyResult {
  const state = cloneState(currentState);
  for (const player of state.players) normalizePropertySets(player, gameVariant(state));
  const events: GameEvent[] = [];

  const player = getPlayer(state, action.playerId);
  if (!player) {
    return { state: currentState, events, error: error('invalid_target', 'Player not found.') };
  }

  const setErr = (err: RuleError): ApplyResult => ({ state: currentState, events, error: err });

  if (state.pending && action.type !== 'counter_response' && action.type !== 'pay_request' && action.type !== 'sly_deal_pick' && action.type !== 'forced_deal_pick' && action.type !== 'deal_breaker_pick' && action.type !== 'repay_debt' && action.type !== 'resolve_debt_card' && action.type !== 'no_mercy_pick' && !(state.pending.kind === 'rent' && action.type === 'play_action')) {
    return setErr(error('unresolved_pending', 'Resolve pending interaction first.'));
  }
  if (state.pending?.kind === 'debt_card' && action.type !== 'resolve_debt_card') {
    return setErr(error('unresolved_pending', 'Resolve the received debt card first.'));
  }
  if (state.pending?.kind === 'no_mercy' && action.type !== 'no_mercy_pick') {
    return setErr(error('unresolved_pending', 'Resolve the No Mercy selection first.'));
  }

  if (action.type === 'draw_cards') {
    if (getCurrentPlayer(state).id !== player.id) return setErr(error('invalid_turn', 'Not your turn.') as RuleError);
    if (state.turn.phase !== 'draw') return setErr(error('invalid_phase', 'Can only draw during draw phase.'));
    const drawAmount = player.hand.length === 0 ? 5 : 2;
    const drawn = drawCards(state, player, drawAmount);
    state.turn.phase = gameVariant(state) === 'no_mercy' && debtsFor(player).length > 0 ? 'debt' : 'action';
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
    if (!player.hand.includes(action.cardId)) return setErr(error('insufficient_cards', 'Card not in hand.'));
    if (!discardableCards(state, player).includes(action.cardId)) return setErr(error('invalid_action', 'Property cards can only be discarded when you hold no other cards.'));
    removeFromHand(player, action.cardId);
    discard(state, action.cardId);
    pushEvent(events, 'discard', `${player.name} discarded ${cardLabel(action.cardId, gameVariant(state))}.`);
    if (state.turn.endingTurn && player.hand.length <= ruleset(state).maxHandAtEndTurn) {
      const err = finishTurn(state, events);
      if (err) return setErr(err);
    }
  }

  if (action.type === 'repay_debt') {
    if (gameVariant(state) !== 'no_mercy') return setErr(error('invalid_action', 'Debt is only used in No Mercy.'));
    if (getCurrentPlayer(state).id !== player.id || state.turn.phase !== 'debt') return setErr(error('invalid_phase', 'Debt repayment is only available before card plays.'));
    if (state.turn.playsUsed >= ruleset(state).maxPlaysPerTurn) {
      return setErr(error('illegal_play_limit', `Already used ${ruleset(state).maxPlaysPerTurn} plays this turn.`));
    }
    const debts = debtsFor(player);
    const debtId = action.debtId ?? action.chipId;
    const debtIndex = debts.findIndex((debt) => debt.id === debtId || debt.chipId === debtId
      || (action.creditorPlayerId && debt.creditorPlayerId === action.creditorPlayerId));
    if (debtIndex < 0) return setErr(error('invalid_target', 'Debt not found.'));
    if (!removeFromHand(player, action.cardId)) return setErr(error('insufficient_cards', 'Repayment card not in hand.'));
    const debt = debts[debtIndex];
    debts.splice(debtIndex, 1);
    player.debtChipsRemaining = Math.min(3, (player.debtChipsRemaining ?? 0) + 1);
    const creditor = getPlayer(state, debt.creditorPlayerId);
    if (!creditor) return setErr(error('invalid_target', 'Creditor not found.'));
    creditor.debtChipsHeld = creditor.debtChipsHeld ?? creditor.debtChips ?? [];
    creditor.debtChips = creditor.debtChipsHeld;
    const heldIndex = creditor.debtChipsHeld.findIndex((chip) => (chip.chipId ?? chip.id) === (debt.chipId ?? debt.id));
    if (heldIndex >= 0) creditor.debtChipsHeld.splice(heldIndex, 1);
    const card = cardDefinition(state, action.cardId);
    if (card.kind === 'money' || card.kind === 'building') {
      creditor.bank.push(action.cardId);
    } else if (card.kind === 'action' || card.kind === 'property' || card.kind === 'wild') {
      state.pending = { kind: 'debt_card', payload: { debtorPlayerId: player.id, creditorPlayerId: creditor.id, debtId: debt.id ?? debt.chipId ?? '', cardId: action.cardId } };
    } else {
      creditor.bank.push(action.cardId);
    }
    consumePlay(state);
    pushEvent(events, 'debt_repaid', `${player.name} repaid ${creditor.name} with ${cardLabel(action.cardId, gameVariant(state))}.`);
    if (debts.length === 0 && !state.pending) state.turn.phase = 'action';
  }

  if (action.type === 'resolve_debt_card') {
    if (state.pending?.kind !== 'debt_card' || state.pending.payload.creditorPlayerId !== player.id) return setErr(error('invalid_action', 'No debt card is awaiting resolution.'));
    if (state.pending.payload.cardId !== action.cardId) return setErr(error('invalid_action', 'Invalid debt card.'));
    const card = cardDefinition(state, action.cardId);
    if (action.mode === 'action') {
      if (card.kind !== 'action' || card.actionKind === 'go_again') return setErr(error('invalid_action', 'This debt card cannot be played immediately.'));
      const choice = receivedActionChoices(state, player, action.cardId)
        .find((candidate) => candidate.targetPlayerId === action.targetPlayerId && candidate.color === action.color);
      if (!choice) return setErr(error('invalid_target', 'Choose a legal immediate action for the received card.'));
      const originalCurrentPlayerIndex = state.currentPlayerIndex;
      const originalTurn = structuredClone(state.turn);
      const temporary = cloneState(state);
      temporary.pending = null;
      temporary.currentPlayerIndex = temporary.players.findIndex((candidate) => candidate.id === player.id);
      temporary.turn = { phase: 'action', playsUsed: 0, doubleRentMultiplier: 1, endingTurn: false };
      const temporaryRecipient = getPlayer(temporary, player.id);
      if (!temporaryRecipient) return setErr(error('invalid_target', 'Creditor not found.'));
      temporaryRecipient.hand.push(action.cardId);
      const nested = applyAction(temporary, choice);
      if (nested.error) return setErr(nested.error);
      if (!nested.state.winnerId) {
        nested.state.currentPlayerIndex = originalCurrentPlayerIndex;
        nested.state.turn = originalTurn;
        settleDebtPhase(nested.state);
      }
      const resolvedEvent: GameEvent = {
        timestamp: now(),
        type: 'debt_card_resolved',
        message: `${player.name} played the received ${card.name} immediately.`,
      };
      nested.state.history.push(resolvedEvent);
      nested.state.updatedAt = now();
      return { state: nested.state, events: [...nested.events, resolvedEvent] };
    }
    if (action.mode === 'bank') {
      if (!canCardBeBanked(card)) return setErr(error('invalid_action', 'This received card cannot be banked.'));
      player.bank.push(action.cardId);
    } else {
      if (!action.color || !canCardBePlacedInColor(card, action.color)) return setErr(error('invalid_target', 'Choose a valid property color.'));
      addToProperty(player, action.cardId, action.color, action.setId, undefined, gameVariant(state));
    }
    state.pending = null;
    if (getPlayer(state, state.currentPlayerIndex >= 0 ? state.players[state.currentPlayerIndex].id : '') && state.turn.phase === 'debt' && debtsFor(getCurrentPlayer(state)).length === 0) state.turn.phase = 'action';
    pushEvent(events, 'debt_card_resolved', `${player.name} resolved a received debt card.`);
  }

  if (action.type === 'no_mercy_pick') {
    if (gameVariant(state) !== 'no_mercy' || state.pending?.kind !== 'no_mercy') {
      return setErr(error('invalid_action', 'No Mercy selection is not pending.'));
    }
    const req = state.pending.payload;
    if (action.actionCardId !== req.actionCardId) return setErr(error('invalid_action', 'Invalid No Mercy selection card.'));
    const target = req.targetPlayerId ? getPlayer(state, req.targetPlayerId) : undefined;
    const actorIsSource = req.step === 'heist_pick' || req.step === 'market_crash_pick' || req.step === 'tough_luck_choice';
    if ((actorIsSource ? req.sourcePlayerId : target?.id) !== player.id) return setErr(error('invalid_action', 'Not your No Mercy selection.'));

    const advanceTargetedEffect = (remaining: PlayerId[]) => {
      state.pending = null;
      if (remaining.length === 0) return;
      const nextEffect: PendingEffect = { kind: 'no_mercy', payload: { ...req, targetPlayerIds: remaining, targetPlayerId: undefined, step: undefined, cardId: undefined } };
      if (!maybeOpenCounter(state, req.sourcePlayerId, remaining[0], req.actionCardId, nextEffect)) resolveEffect(state, nextEffect, events);
    };

    if (req.step === 'heist_pick') {
      if (!target || !action.cardId || !target.bank.includes(action.cardId)) return setErr(error('invalid_target', 'Choose a card from the target Bank.'));
      target.bank.splice(target.bank.indexOf(action.cardId), 1);
      const source = getPlayer(state, req.sourcePlayerId);
      if (source) source.bank.push(action.cardId);
      pushEvent(events, 'heist', `${source?.name ?? 'Player'} stole a bank card from ${target.name}.`);
      advanceTargetedEffect((req.targetPlayerIds ?? []).slice(1));
    }

    if (req.step === 'market_crash_pick') {
      if (!target || !action.cardId || !action.color) return setErr(error('invalid_target', 'Choose a property from the target collection.'));
      const chosen = target.properties[action.color].find((entry) => entry.cardId === action.cardId);
      if (!chosen || !['property', 'wild'].includes(cardDefinition(state, chosen.cardId).kind)) return setErr(error('invalid_target', 'Choose a property from the target collection.'));
      const removed = removePropertyCard(target, action.color, action.cardId, chosen.setId);
      const source = getPlayer(state, req.sourcePlayerId);
      if (removed && source) {
        addToProperty(source, removed.cardId, action.color, undefined, removed.attachedToCardId, 'no_mercy');
        const destinationSetId = findPropertySetIdByCard(source, action.color, removed.cardId, gameVariant(state));
        for (const attachment of attachedPropertyCards(target, action.color, action.cardId, chosen.setId)) {
          removePropertyCard(target, action.color, attachment.cardId, chosen.setId);
          addToProperty(source, attachment.cardId, action.color, destinationSetId, attachment.attachedToCardId, 'no_mercy');
        }
      }
      advanceTargetedEffect((req.targetPlayerIds ?? []).slice(1));
    }

    if (req.step === 'tough_luck_choice') {
      if (req.sourcePlayerId !== player.id || !target || !action.choice) return setErr(error('invalid_target', 'Choose a Tough Luck card type.'));
      const matches = target.hand.filter((cardId) => {
        const kind = cardDefinition(state, cardId).kind;
        if (action.choice === 'property') return kind === 'property' || kind === 'wild';
        if (action.choice === 'money') return kind === 'money';
        return kind === 'action' || kind === 'building';
      });
      target.hand = target.hand.filter((cardId) => !matches.includes(cardId));
      player.hand.push(...matches);
      state.pending = null;
    }

    if (req.step === 'repossession_keep') {
      if (!target || !action.cardId || !action.color) return setErr(error('invalid_target', 'Choose one property to keep.'));
      const keep = target.properties[action.color].find((entry) => entry.cardId === action.cardId);
      if (!keep || !['property', 'wild'].includes(cardDefinition(state, keep.cardId).kind)) return setErr(error('invalid_target', 'Choose one property to keep.'));
      const all = PROPERTY_COLORS.flatMap((color) => target.properties[color].map((entry) => ({ color, entry })));
      const keepIds = new Set([keep.cardId]);
      for (const item of all) if (item.entry.attachedToCardId === keep.cardId) keepIds.add(item.entry.cardId);
      const redistribution: NonNullable<PendingNoMercy['redistribution']> = [];
      for (const item of all) {
        if (keepIds.has(item.entry.cardId)) continue;
        // Leave Shack attachments in place until their parent property is
        // assigned; they must travel with that property as one physical unit.
        if (item.entry.attachedToCardId) continue;
        const removed = removePropertyCard(target, item.color, item.entry.cardId, item.entry.setId);
        if (removed) redistribution.push({ cardId: removed.cardId, color: item.color, setId: removed.setId });
      }
      state.pending = redistribution.length > 0
        ? { kind: 'no_mercy', payload: { ...req, step: 'repossession_distribute', redistribution } }
        : null;
    }

    if (req.step === 'tax_collector_keep') {
      if (!target || !action.cardId || !target.bank.includes(action.cardId)) return setErr(error('invalid_target', 'Choose one Bank card to keep.'));
      const remaining = target.bank.filter((cardId) => cardId !== action.cardId);
      target.bank = [action.cardId];
      const redistribution = remaining.map((cardId) => ({ cardId }));
      state.pending = redistribution.length > 0
        ? { kind: 'no_mercy', payload: { ...req, step: 'tax_collector_distribute', redistribution } }
        : null;
    }

    if ((req.step === 'repossession_distribute' || req.step === 'tax_collector_distribute') && target && req.redistribution?.length) {
      const recipient = action.recipientPlayerId ? getPlayer(state, action.recipientPlayerId) : undefined;
      const item = req.redistribution[0];
      if (!recipient || recipient.id === target.id || recipient.id === target.id || item.cardId !== action.cardId) return setErr(error('invalid_target', 'Choose another player for this card.'));
      const def = cardDefinition(state, item.cardId);
      const destination = item.color ?? (def.kind === 'property' ? def.color : undefined);
      if (def.kind === 'money' || def.kind === 'action' || def.kind === 'building') {
        recipient.bank.push(item.cardId);
      } else if (destination) {
        addToProperty(recipient, item.cardId, destination, undefined, item.attachedToCardId, 'no_mercy');
        const destinationSetId = findPropertySetIdByCard(recipient, destination, item.cardId, gameVariant(state));
        if (req.step === 'repossession_distribute') {
          for (const attachment of [...(target.properties[destination] ?? [])].filter((entry) => entry.attachedToCardId === item.cardId)) {
            removePropertyCard(target, destination, attachment.cardId, attachment.setId);
            addToProperty(recipient, attachment.cardId, destination, destinationSetId, attachment.attachedToCardId, 'no_mercy');
          }
        }
      } else {
        return setErr(error('invalid_target', 'Transferred card needs a property color.'));
      }
      const remaining = req.redistribution.slice(1);
      state.pending = remaining.length > 0 ? { kind: 'no_mercy', payload: { ...req, redistribution: remaining } } : null;
    }
  }

  if (action.type === 'play_to_bank') {
    if (getCurrentPlayer(state).id !== player.id) return setErr(error('invalid_action', 'Not your turn.'));
    if (state.turn.phase !== 'action') return setErr(error('invalid_phase', 'Cannot play now.'));
    if (state.turn.playsUsed >= ruleset(state).maxPlaysPerTurn) {
      return setErr(error('illegal_play_limit', `Already used ${ruleset(state).maxPlaysPerTurn} plays this turn.`));
    }
    const card = cardDefinition(state, action.cardId);
    if (!canCardBeBanked(card)) {
      return setErr(error('invalid_action', 'Only money, action, and building cards can be banked.'));
    }
    if (!removeFromHand(player, action.cardId)) return setErr(error('insufficient_cards', 'Card not in hand.'));
    player.bank.push(action.cardId);
    consumePlay(state);
    pushEvent(events, 'bank', `${player.name} banked ${cardLabel(action.cardId, gameVariant(state))}.`);
  }

  if (action.type === 'play_property') {
    if (getCurrentPlayer(state).id !== player.id) return setErr(error('invalid_action', 'Not your turn.'));
    if (state.turn.phase !== 'action') return setErr(error('invalid_phase', 'Cannot play now.'));
    if (state.turn.playsUsed >= ruleset(state).maxPlaysPerTurn) {
      return setErr(error('illegal_play_limit', `Already used ${ruleset(state).maxPlaysPerTurn} plays this turn.`));
    }
    const card = cardDefinition(state, action.cardId);
    let placementSetId = action.setId;
    if (card.kind === 'building') {
      if (gameVariant(state) === 'no_mercy' && card.actionKind === 'shack') {
        const targetSet = propertySets(player, action.color, gameVariant(state)).find((set) => !action.setId || set.setId === action.setId);
        const attachedTo = action.attachedToCardId
          ?? targetSet?.entries.find((entry) => {
            const def = cardDefinition(state, entry.cardId);
            return (def.kind === 'property' || def.kind === 'wild') && !targetSet.entries.some((attachment) => attachment.attachedToCardId === entry.cardId);
          })?.cardId;
        if (!targetSet || !isShackPlacementLegal(player, action.color, targetSet.setId, attachedTo, gameVariant(state))) {
          return setErr(error('invalid_action', 'Shack must attach to a property or set without a Shack.'));
        }
        placementSetId = targetSet.setId;
        if (!removeFromHand(player, action.cardId)) return setErr(error('insufficient_cards', 'Card not in hand.'));
        addToProperty(player, action.cardId, action.color, placementSetId, attachedTo, gameVariant(state));
        consumePlay(state);
        pushEvent(events, 'property', `${player.name} attached a Shack to ${colorLabel(action.color)}.`);
        // Skip the normal House/Hotel branch below.
        checkWinner(state);
        if (events.length > 0) state.history.push(...events);
        state.updatedAt = now();
        return { state, events };
      }
      const eligibleSetIds = propertySets(player, action.color, gameVariant(state))
        .filter((set) => isBuildingPlacementLegal(player, action.color, card.actionKind as 'house' | 'hotel', set.setId, gameVariant(state)))
        .map((set) => set.setId);
      if (!action.setId && eligibleSetIds.length > 1) {
        return setErr(error('invalid_target', 'Choose which physical property set receives this building.'));
      }
      placementSetId = action.setId ?? eligibleSetIds[0];
      if (!isBuildingPlacementLegal(player, action.color, card.actionKind as 'house' | 'hotel', placementSetId, gameVariant(state))) {
        return setErr(error('invalid_action', 'Building requires a complete property set.'));
      }
    } else if (!canCardBePlacedInColor(card, action.color)) {
      return setErr(error('invalid_action', 'Card cannot be placed in that color group.'));
    } else if (action.setId && completeSet(state, player, action.color, action.setId)) {
      return setErr(error('invalid_action', 'Cannot place an excess property into a protected complete set.'));
    }

    if (!removeFromHand(player, action.cardId)) return setErr(error('insufficient_cards', 'Card not in hand.'));

    addToProperty(player, action.cardId, action.color, placementSetId, undefined, gameVariant(state));
    if (gameVariant(state) === 'no_mercy') {
      const resultingSetId = findPropertySetIdByCard(player, action.color, action.cardId, gameVariant(state));
      const resultingSet = propertySets(player, action.color, gameVariant(state)).find((set) => set.setId === resultingSetId);
      const shackCount = resultingSet?.entries.filter((entry) => cardDefinition(state, entry.cardId).actionKind === 'shack').length ?? 0;
      if (resultingSet && isCompleteSet(player, action.color, resultingSet.setId, gameVariant(state)) && shackCount > 1) {
        return setErr(error('invalid_action', 'A complete No Mercy set may have only one Shack.'));
      }
    }
    consumePlay(state);
    pushEvent(events, 'property', `${player.name} placed ${cardLabel(action.cardId, gameVariant(state))} in ${colorLabel(action.color)}.`);
  }

  if (action.type === 'move_wild') {
    if (getCurrentPlayer(state).id !== player.id) return setErr(error('invalid_action', 'Not your turn.'));
    if (state.turn.phase !== 'action') return setErr(error('invalid_phase', 'Cannot move now.'));
    const moved = removePropertyCard(player, action.fromColor, action.cardId, action.fromSetId);
    if (!moved) return setErr(error('invalid_target', 'Wild card not found in source set.'));
    if (gameVariant(state) === 'no_mercy' && attachedPropertyCards(player, action.fromColor, action.cardId, moved.setId).length > 0) {
      addToProperty(player, action.cardId, action.fromColor, moved.setId, moved.attachedToCardId, gameVariant(state));
      return setErr(error('invalid_action', 'A property with a Shack cannot be moved.'));
    }
    const def = cardDefinition(state, action.cardId);
    if (def.kind !== 'wild' || !canCardBePlacedInColor(def, action.toColor)
      || (action.setId && completeSet(state, player, action.toColor, action.setId))) {
      addToProperty(player, action.cardId, action.fromColor, moved.setId, undefined, gameVariant(state));
      return setErr(error('invalid_action', 'Card cannot move to target color.'));
    }
    addToProperty(player, action.cardId, action.toColor, action.setId, undefined, gameVariant(state));
    pushEvent(events, 'wild_move', `${player.name} moved ${cardLabel(action.cardId, gameVariant(state))} to ${colorLabel(action.toColor)}.`);
  }

  if (action.type === 'play_action') {
    if (state.pending?.kind === 'rent') {
      const pending = state.pending.payload;
      if (pending.sourcePlayerId !== player.id) return setErr(error('invalid_action', 'Only source player can choose rent target.'));
      if (!action.targetPlayerId) return setErr(error('invalid_target', 'Rent target required.'));
      const target = getPlayer(state, action.targetPlayerId);
      if (!target) return setErr(error('invalid_target', 'Target player not found.'));
      if (target.id === player.id) return setErr(error('invalid_target', 'Cannot charge yourself rent.'));
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
      const card = cardDefinition(state, action.cardId);
      if (card.kind !== 'action') return setErr(error('invalid_action', 'Building cards must be placed on a complete property set.'));
      if (card.actionKind === 'just_say_no') return setErr(error('invalid_action', 'Just Say No can only be played as response.'));
      const actionKind = card.actionKind as ActionKind;
      let validatedTarget: PlayerState | null = null;

      if (actionKind === 'debt_collector' || actionKind === 'sly_deal' || actionKind === 'forced_deal' || actionKind === 'deal_breaker'
        || (gameVariant(state) === 'no_mercy' && ['forced_debt', 'repossession', 'tax_collector', 'tough_luck', 'unfair_trade', 'yoink'].includes(actionKind))) {
        if (!action.targetPlayerId) return setErr(error('invalid_target', 'Target required.'));
        const target = getPlayer(state, action.targetPlayerId);
        if (!target) return setErr(error('invalid_target', 'Target not found.'));
        if (target.id === player.id) return setErr(error('invalid_target', 'Cannot target yourself.'));
        validatedTarget = target;
      }

      if (actionKind === 'sly_deal' && validatedTarget && movablePropertyCards(validatedTarget, gameVariant(state)).length === 0) {
        return setErr(error('invalid_action', 'Target has no movable property cards.'));
      }

      if (actionKind === 'forced_deal' && validatedTarget) {
        if (movablePropertyCards(player, gameVariant(state)).length === 0) return setErr(error('invalid_action', 'You have no movable property cards.'));
        if (movablePropertyCards(validatedTarget, gameVariant(state)).length === 0) {
          return setErr(error('invalid_action', 'Target has no movable property cards.'));
        }
      }

      if (actionKind === 'deal_breaker' && validatedTarget && completeSetColors(validatedTarget, gameVariant(state)).length === 0) {
        return setErr(error('invalid_action', 'Target has no complete property sets.'));
      }

      if (gameVariant(state) === 'no_mercy' && actionKind === 'forced_debt' && validatedTarget && !canIssueDebt(state, validatedTarget)) {
        return setErr(error('invalid_action', 'Target has reached the No Mercy debt-chip limit.'));
      }

      if (actionKind === 'double_rent') {
        if (gameVariant(state) === 'classic' && !canPlayDoubleRent(state, player, action.cardId)) {
          return setErr(error('invalid_action', 'Double Rent requires a playable rent card this turn.'));
        }
        if (gameVariant(state) === 'no_mercy') {
          if (!action.color) return setErr(error('invalid_target', 'Double Rent color required.'));
          const allowedColors = Object.keys(card.rentMatrix ?? {}) as PropertyColor[];
          if (!allowedColors.includes(action.color)) return setErr(error('invalid_target', 'Double Rent card cannot target that color.'));
          if (getRentAmount(player, action.color, gameVariant(state)) <= 0) {
            return setErr(error('invalid_action', 'You do not own a standard property for that rent color.'));
          }
        }
      }

      if (actionKind === 'rent' || actionKind === 'rent_wild') {
        if (!action.color) return setErr(error('invalid_target', 'Rent color required.'));
        const allowedColors = Object.keys(card.rentMatrix ?? {}) as PropertyColor[];
        if (!allowedColors.includes(action.color)) return setErr(error('invalid_target', 'Rent card cannot target that color.'));
        if (getRentAmount(player, action.color, gameVariant(state)) <= 0) return setErr(error('invalid_action', 'You do not own a standard property for that rent color.'));
      }

      if (gameVariant(state) === 'no_mercy' && actionKind === 'super_sly_deal') {
        if (!action.color || !PROPERTY_COLORS.includes(action.color)) return setErr(error('invalid_target', 'Choose a property color.'));
        const hasMatch = state.players.some((target) => target.id !== player.id && target.properties[action.color!].some((entry) => {
          const def = cardDefinition(state, entry.cardId);
          return (def.kind === 'property' && def.color === action.color)
            || (def.kind === 'wild' && (def.colors ?? []).includes(action.color!));
        }));
        if (!hasMatch) return setErr(error('invalid_action', 'No opponent has a property matching that color.'));
      }

      if (!removeFromHand(player, action.cardId)) return setErr(error('insufficient_cards', 'Card not in hand.'));
      discard(state, action.cardId);

      if (actionKind === 'pass_go') {
        const drawCount = gameVariant(state) === 'no_mercy' && card.id === 'pass_go_go_go'
          ? Math.max(0, 7 - player.hand.length) : 2;
        const drawn = drawCards(state, player, drawCount);
        pushEvent(events, 'action', `${player.name} played Pass Go and drew ${drawn.length}.`, {
          kind: 'draw',
          playerId: player.id,
          count: drawn.length,
          reason: 'pass_go',
        });
      }

      if (actionKind === 'double_rent' && gameVariant(state) === 'classic') {
        state.turn.doubleRentMultiplier *= 2;
        pushEvent(events, 'action', `${player.name} played Double Rent.`);
      }

      if (gameVariant(state) === 'no_mercy' && actionKind === 'double_rent') {
        const color = action.color;
        if (!color) return setErr(error('invalid_target', 'Double Rent color required.'));
        const amount = getRentAmount(player, color, gameVariant(state)) * 2;
        const targets = state.players.filter((target) => target.id !== player.id).map((target) => target.id);
        if (targets.length > 0) {
          const firstTarget = targets[0];
          const paymentEffect: PendingEffect = {
            kind: 'payment',
            payload: {
              sourcePlayerId: player.id,
              targetPlayerId: firstTarget,
              amount,
              reason: `Double Rent (${color})`,
              actionCardId: action.cardId,
              remainingTargetPlayerIds: targets.slice(1),
            },
          };
          if (!maybeOpenCounter(state, player.id, firstTarget, action.cardId, paymentEffect)) {
            resolveEffect(state, paymentEffect, events);
          }
        }
        pushEvent(events, 'action', `${player.name} played Double Rent for ${colorLabel(color)} at $${amount}.`);
      }

      if (gameVariant(state) === 'no_mercy' && actionKind === 'go_again') {
        state.currentPlayerIndex = state.players.findIndex((candidate) => candidate.id === player.id);
        state.turn = { phase: 'draw', playsUsed: 0, doubleRentMultiplier: 1, endingTurn: false };
        state.turnCount += 1;
        pushEvent(events, 'go_again', `${player.name} gets another turn.`);
      }

      if (gameVariant(state) === 'no_mercy' && actionKind === 'forced_debt' && validatedTarget) {
        const effect: PendingEffect = { kind: 'no_mercy', payload: { sourcePlayerId: player.id, actionCardId: action.cardId, effect: 'forced_debt', targetPlayerId: validatedTarget.id } };
        if (!maybeOpenCounter(state, player.id, validatedTarget.id, action.cardId, effect)) resolveEffect(state, effect, events);
      }

      if (gameVariant(state) === 'no_mercy' && actionKind === 'heist') {
        // A player with no Bank card is not affected by Heist and therefore
        // does not receive a needless Just Say No window.
        const targets = state.players.filter((target) => target.id !== player.id && target.bank.length > 0).map((target) => target.id);
        if (targets.length > 0) {
          const effect: PendingEffect = { kind: 'no_mercy', payload: { sourcePlayerId: player.id, actionCardId: action.cardId, effect: 'heist', targetPlayerIds: targets } };
          if (!maybeOpenCounter(state, player.id, targets[0], action.cardId, effect)) resolveEffect(state, effect, events);
        }
      }

      if (gameVariant(state) === 'no_mercy' && actionKind === 'market_crash') {
        const targets = state.players.filter((target) => target.id !== player.id && PROPERTY_COLORS.some((color) => target.properties[color].some((entry) => {
          const def = cardDefinition(state, entry.cardId);
          return def.kind === 'property' || def.kind === 'wild';
        }))).map((target) => target.id);
        const effect: PendingEffect = { kind: 'no_mercy', payload: { sourcePlayerId: player.id, actionCardId: action.cardId, effect: 'market_crash', targetPlayerIds: targets } };
        if (targets.length > 0 && !maybeOpenCounter(state, player.id, targets[0], action.cardId, effect)) resolveEffect(state, effect, events);
      }

      if (gameVariant(state) === 'no_mercy' && actionKind === 'super_sly_deal') {
        const selectedColor = action.color;
        const targets = state.players.filter((target) => target.id !== player.id && selectedColor && target.properties[selectedColor].some((entry) => {
          const def = cardDefinition(state, entry.cardId);
          return (def.kind === 'property' && def.color === selectedColor)
            || (def.kind === 'wild' && (def.colors ?? []).includes(selectedColor));
        })).map((target) => target.id);
        const effect: PendingEffect = { kind: 'no_mercy', payload: { sourcePlayerId: player.id, actionCardId: action.cardId, effect: 'super_sly_deal', targetPlayerIds: targets, color: selectedColor } };
        if (targets.length > 0 && !maybeOpenCounter(state, player.id, targets[0], action.cardId, effect)) resolveEffect(state, effect, events);
      }

      if (gameVariant(state) === 'no_mercy' && (actionKind === 'repossession' || actionKind === 'tax_collector' || actionKind === 'tough_luck' || actionKind === 'unfair_trade') && validatedTarget) {
        const effect: PendingEffect = {
          kind: 'no_mercy',
          payload: { sourcePlayerId: player.id, actionCardId: action.cardId, effect: actionKind, targetPlayerId: validatedTarget.id },
        };
        if (!maybeOpenCounter(state, player.id, validatedTarget.id, action.cardId, effect)) resolveEffect(state, effect, events);
      }

      if (gameVariant(state) === 'no_mercy' && actionKind === 'yoink' && validatedTarget) {
        const effect: PendingEffect = {
          kind: 'payment',
          payload: { sourcePlayerId: player.id, targetPlayerId: validatedTarget.id, amount: 10, reason: 'Yoink!', actionCardId: action.cardId },
        };
        if (!maybeOpenCounter(state, player.id, validatedTarget.id, action.cardId, effect)) resolveEffect(state, effect, events);
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
        const amount = getRentAmount(player, action.color, gameVariant(state)) * state.turn.doubleRentMultiplier;
        state.turn.doubleRentMultiplier = 1;
        if (actionKind === 'rent' && gameVariant(state) === 'classic') {
          state.pending = {
            kind: 'rent',
            payload: {
              sourcePlayerId: player.id,
              actionCardId: action.cardId,
              color: action.color,
              amount,
            },
          };
        } else {
          const targets = state.players.filter((target) => target.id !== player.id).map((target) => target.id);
          if (targets.length > 0) {
            const firstTarget = targets[0];
            const paymentEffect: PendingEffect = {
              kind: 'payment',
              payload: {
                sourcePlayerId: player.id,
                targetPlayerId: firstTarget,
                amount,
                reason: `Rent (${action.color})`,
                actionCardId: action.cardId,
                remainingTargetPlayerIds: targets.slice(1),
              },
            };
            if (!maybeOpenCounter(state, player.id, firstTarget, action.cardId, paymentEffect)) {
              resolveEffect(state, paymentEffect, events);
            }
          }
        }
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

      if (actionKind !== 'go_again') consumePlay(state);
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
      // No Mercy global effects still use the ordinary Just Say No chain. A
      // source player may answer a target's Just Say No, but the final result
      // applies only to that target; the remaining targets get their own
      // independent counter windows below.
      pending.awaitingPlayerId = pending.awaitingPlayerId === pending.targetPlayerId ? pending.sourcePlayerId : pending.targetPlayerId;
      state.pending = { kind: 'counter', payload: pending };
      pushEvent(events, 'counter', `${player.name} played Just Say No.`);
    } else {
      const canceled = pending.chain.length % 2 === 1;
      state.pending = null;
      if (pending.effect.kind === 'no_mercy') {
        const targets = pending.effect.payload.targetPlayerIds ?? [];
        const remainingTargets = targets.slice(1);
        if (canceled) {
          if (remainingTargets.length > 0) {
            const nextEffect: PendingEffect = {
              kind: 'no_mercy',
              payload: { ...pending.effect.payload, targetPlayerIds: remainingTargets, targetPlayerId: undefined, step: undefined },
            };
            if (!maybeOpenCounter(state, pending.effect.payload.sourcePlayerId, remainingTargets[0], pending.effect.payload.actionCardId, nextEffect)) {
              resolveEffect(state, nextEffect, events);
            }
          }
          pushEvent(events, 'counter', 'Action canceled for this target by Just Say No chain.');
        } else {
          // Re-run the effect for the current target. Global effect payloads
          // retain the full target list so the selection step can continue to
          // the remaining players after this target resolves.
          resolveEffect(state, pending.effect, events);
          pushEvent(events, 'counter', 'Action resolved after counter chain.');
          progressNoMercy(state, events);
        }
      } else if (!canceled) {
        resolveEffect(state, pending.effect, events);
        pushEvent(events, 'counter', 'Action resolved after counter chain.');
        progressNoMercy(state, events);
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
    const variant = gameVariant(state);
    for (const cardId of selected) {
      const inBank = payer.bank.includes(cardId);
      const inProperty = findPropertyColorByCard(payer, cardId) !== null;
      if (!inBank && !inProperty) {
        return setErr(error('invalid_action', `Cannot pay with ${cardId}.`));
      }
      if (variant === 'no_mercy' && isEveryColorWild(cardId, variant)) {
        return setErr(error('invalid_action', 'An every-color Wild cannot be used as payment.'));
      }
    }

    const total = [...selected].reduce((sum, cardId) => sum + cardMoneyValue(cardId, variant), 0);
    const payableTotal = totalPayableValue(payer, variant);
    if (payableTotal >= req.amount && total < req.amount) {
      return setErr(error('invalid_action', `Payment must total at least $${req.amount}.`));
    }
    if (payableTotal < req.amount && total < payableTotal) {
      return setErr(error('invalid_action', 'Player must pay all available cards when total funds are insufficient.'));
    }

    // Move property cards before their attached buildings so a Shack travels
    // with the property as one physical unit. An attached building selected on
    // its own is treated as a Bank card, matching the printed Shack rule.
    const selectedIds = new Set(selected);
    const orderedSelected = [...selected].sort((left, right) => {
      const leftColor = findPropertyColorByCard(payer, left);
      const rightColor = findPropertyColorByCard(payer, right);
      const leftPlacement = leftColor ? payer.properties[leftColor].find((entry) => entry.cardId === left) : undefined;
      const rightPlacement = rightColor ? payer.properties[rightColor].find((entry) => entry.cardId === right) : undefined;
      const leftIsParent = leftPlacement ? payer.properties[leftColor!].some((entry) => entry.attachedToCardId === left) : false;
      const rightIsParent = rightPlacement ? payer.properties[rightColor!].some((entry) => entry.attachedToCardId === right) : false;
      return Number(rightIsParent) - Number(leftIsParent);
    });
    const transferred = new Set<string>();
    for (const cardId of orderedSelected) {
      if (transferred.has(cardId)) continue;
      const bankIdx = payer.bank.indexOf(cardId);
      if (bankIdx >= 0) {
        payer.bank.splice(bankIdx, 1);
        collector.bank.push(cardId);
        transferred.add(cardId);
        continue;
      }
      const propColor = findPropertyColorByCard(payer, cardId);
      if (propColor) {
        const placement = payer.properties[propColor].find((entry) => entry.cardId === cardId);
        if (placement?.attachedToCardId && selectedIds.has(placement.attachedToCardId)) continue;
        const removed = removePropertyCard(payer, propColor, cardId);
        if (removed) {
          const def = cardDefinition(state, cardId);
          if (def.kind === 'building') {
            collector.bank.push(cardId);
          } else {
            const assign = def.kind === 'property' ? def.color! : propColor;
            addToProperty(collector, cardId, assign, undefined, undefined, variant);
            const destinationSetId = findPropertySetIdByCard(collector, assign, cardId, variant);
            for (const attachment of attachedPropertyCards(payer, propColor, cardId, removed.setId)) {
              removePropertyCard(payer, propColor, attachment.cardId, removed.setId);
              if (destinationSetId) {
                addToProperty(collector, attachment.cardId, assign, destinationSetId, attachment.attachedToCardId, variant);
              } else {
                collector.bank.push(attachment.cardId);
              }
              transferred.add(attachment.cardId);
            }
          }
          transferred.add(cardId);
        }
      }
    }

    state.pending = null;
    if (variant === 'no_mercy' && total < req.amount) issueDebt(state, payer, collector, req.amount - total);
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
    const sourceSetId = action.sourceSetId ?? findPropertySetIdByCard(target, action.sourceColor, action.cardId, gameVariant(state));
    const sourceSetWasComplete = completeSet(state, target, action.sourceColor, sourceSetId);
    const removed = removePropertyCard(target, action.sourceColor, action.cardId, sourceSetId);
    if (!removed) return setErr(error('invalid_target', 'Card not found in target set.'));
    if (sourceSetWasComplete) {
      addToProperty(target, action.cardId, action.sourceColor, removed.setId, undefined, gameVariant(state));
      return setErr(error('invalid_action', 'Cannot steal cards from a complete set.'));
    }
    const def = cardDefinition(state, action.cardId);
    if (!canCardBePlacedInColor(def, action.destinationColor)
      || (action.setId && completeSet(state, source, action.destinationColor, action.setId))) {
      addToProperty(target, action.cardId, action.sourceColor, removed.setId, undefined, gameVariant(state));
      return setErr(error('invalid_action', 'Cannot place card in selected destination.'));
    }

    addToProperty(source, action.cardId, action.destinationColor, action.setId, removed.attachedToCardId, gameVariant(state));
    for (const attachment of attachedPropertyCards(target, action.sourceColor, action.cardId, sourceSetId)) {
      removePropertyCard(target, action.sourceColor, attachment.cardId, sourceSetId);
      addToProperty(source, attachment.cardId, action.destinationColor, action.setId, attachment.attachedToCardId, gameVariant(state));
    }
    state.pending = null;
    pushEvent(events, 'sly_deal', `${source.name} took ${cardLabel(action.cardId, gameVariant(state))} from ${target.name}.`, {
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
    const giveSetId = action.giveSetId ?? findPropertySetIdByCard(source, action.giveColor, action.giveCardId, gameVariant(state));
    const takeSetId = action.takeSetId ?? findPropertySetIdByCard(target, action.takeColor, action.takeCardId, gameVariant(state));
    const giveSetWasComplete = completeSet(state, source, action.giveColor, giveSetId);
    const takeSetWasComplete = completeSet(state, target, action.takeColor, takeSetId);
    const give = removePropertyCard(source, action.giveColor, action.giveCardId, giveSetId);
    const take = removePropertyCard(target, action.takeColor, action.takeCardId, takeSetId);
    if (!give || !take) {
      if (give) addToProperty(source, give.cardId, action.giveColor, give.setId, undefined, gameVariant(state));
      if (take) addToProperty(target, take.cardId, action.takeColor, take.setId, undefined, gameVariant(state));
      return setErr(error('invalid_target', 'Swap card not found.'));
    }
    if (giveSetWasComplete || takeSetWasComplete) {
      addToProperty(source, give.cardId, action.giveColor, give.setId, undefined, gameVariant(state));
      addToProperty(target, take.cardId, action.takeColor, take.setId, undefined, gameVariant(state));
      return setErr(error('invalid_action', 'Cannot swap cards that are part of a complete set.'));
    }

    const takeDef = cardDefinition(state, take.cardId);
    const giveDef = cardDefinition(state, give.cardId);
    const targetDestinationColor = giveDef.kind === 'property' ? giveDef.color! : action.giveColor;
    if (!canCardBePlacedInColor(takeDef, action.destinationColor)
      || (action.setId && completeSet(state, source, action.destinationColor, action.setId))
      || (giveDef.kind === 'wild' && !canCardBePlacedInColor(giveDef, targetDestinationColor))) {
      addToProperty(source, give.cardId, action.giveColor, give.setId, undefined, gameVariant(state));
      addToProperty(target, take.cardId, action.takeColor, take.setId, undefined, gameVariant(state));
      return setErr(error('invalid_action', 'Cannot place taken card in destination.'));
    }

    addToProperty(source, take.cardId, action.destinationColor, action.setId, take.attachedToCardId, gameVariant(state));
    addToProperty(target, give.cardId, targetDestinationColor, undefined, give.attachedToCardId, gameVariant(state));
    for (const attachment of attachedPropertyCards(target, action.takeColor, action.takeCardId, takeSetId)) {
      removePropertyCard(target, action.takeColor, attachment.cardId, takeSetId);
      addToProperty(source, attachment.cardId, action.destinationColor, action.setId, attachment.attachedToCardId, gameVariant(state));
    }
    for (const attachment of attachedPropertyCards(source, action.giveColor, action.giveCardId, giveSetId)) {
      removePropertyCard(source, action.giveColor, attachment.cardId, giveSetId);
      addToProperty(target, attachment.cardId, targetDestinationColor, undefined, attachment.attachedToCardId, gameVariant(state));
    }

    state.pending = null;
    pushEvent(events, 'forced_deal', `${source.name} swapped ${cardLabel(action.giveCardId, gameVariant(state))} for ${cardLabel(action.takeCardId, gameVariant(state))}.`, {
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
    const completeSets = propertySets(target, action.color, gameVariant(state))
      .filter((set) => completeSet(state, target, action.color, set.setId));
    const selectedSet = action.setId
      ? completeSets.find((set) => set.setId === action.setId)
      : completeSets.length === 1
        ? completeSets[0]
        : undefined;
    if (!selectedSet || !completeSet(state, target, action.color, selectedSet.setId)) {
      return setErr(error('invalid_action', 'Target set is not complete.'));
    }

    const cards = [...selectedSet.entries];
    target.properties[action.color] = target.properties[action.color]
      .filter((entry) => entry.setId !== selectedSet.setId);
    const stolenSetId = allocatePropertySetId(source, action.color, `${action.color}:stolen-${selectedSet.setId}`, gameVariant(state));
    for (const entry of cards) {
      const def = cardDefinition(state, entry.cardId);
      const destination = def.kind === 'property' ? def.color! : action.color;
      addToProperty(source, entry.cardId, destination, stolenSetId, entry.attachedToCardId, gameVariant(state));
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

  progressNoMercy(state, events);
  settleDebtPhase(state);

  if (events.length > 0) {
    state.history.push(...events);
  }
  state.updatedAt = now();

  return { state, events };
}

export function isGameOver(state: GameState): { done: boolean; winnerId?: PlayerId } {
  if (state.winnerId) return { done: true, winnerId: state.winnerId };
  const winner = state.players.find((player) => countCompleteSets(player, gameVariant(state)) >= ruleset(state).winCompleteSets);
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
    const actionCardName = cardLabel(state.pending.payload.actionCardId, gameVariant(state));
    return {
      playerId: pendingPlayer?.id ?? currentPlayer.id,
      text: `${pendingPlayer?.name ?? 'Player'}: respond to ${sourceName}'s ${actionCardName} or allow it to resolve.`,
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

  if (state.pending?.kind === 'debt_card') {
    const recipient = getPlayer(state, state.pending.payload.creditorPlayerId);
    return {
      playerId: recipient?.id ?? currentPlayer.id,
      text: `${recipient?.name ?? 'Player'}: resolve the card received for debt repayment.`,
      kind: 'selection',
    };
  }

  if (state.pending?.kind === 'no_mercy') {
    const req = state.pending.payload;
    const target = req.targetPlayerId ? getPlayer(state, req.targetPlayerId) : undefined;
    const actorId = req.step === 'heist_pick' || req.step === 'market_crash_pick' || req.step === 'tough_luck_choice'
      ? req.sourcePlayerId
      : target?.id ?? req.sourcePlayerId;
    const actor = getPlayer(state, actorId);
    return {
      playerId: actor?.id ?? currentPlayer.id,
      text: req.step === 'tough_luck_choice'
        ? `${actor?.name ?? 'Player'}: choose which card type Tough Luck takes.`
        : req.step?.endsWith('_distribute')
          ? `${actor?.name ?? 'Player'}: choose who receives the next redistributed card.`
          : `${actor?.name ?? 'Player'}: resolve the No Mercy effect.` ,
      kind: 'selection',
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

  if (state.turn.phase === 'debt') {
    return {
      playerId: currentPlayer.id,
      text: `${currentPlayer.name}: repay outstanding debt before playing cards.`,
      kind: 'debt',
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

export function getSetCompletionCount(player: PlayerState, variant: GameVariant = 'classic'): number {
  return countCompleteSets(player, variant);
}
