import { getCardDefinition } from '../cards/catalog';
import { DEFAULT_RULESET, getSetCompletionCount, type Action, type GameState, type LegalAction, type PlayerId } from '../engine';

export interface ScoredAction {
  action: Action;
  label: string;
  score: number;
  reason: string;
}

function moneyValue(cardId: string): number {
  const card = getCardDefinition(cardId);
  return card.moneyValue ?? card.value;
}

function currentPlayerScore(state: GameState, playerId: PlayerId): number {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) return 0;
  const sets = getSetCompletionCount(player);
  const bankValue = player.bank.reduce((sum, cardId) => sum + moneyValue(cardId), 0);
  return sets * 100 + bankValue;
}

function actionScore(state: GameState, actorId: PlayerId, item: LegalAction): ScoredAction {
  const { action } = item;

  if (action.type === 'draw_cards') {
    return { action, label: item.label, score: 900, reason: 'Drawing unlocks the whole turn.' };
  }

  if (action.type === 'discard_card') {
    const value = moneyValue(action.cardId);
    return {
      action,
      label: item.label,
      score: 80 - value,
      reason: `Discarding a lower-value card preserves stronger options.` ,
    };
  }

  if (action.type === 'counter_response') {
    if (action.useJustSayNo) {
      return { action, label: item.label, score: 500, reason: 'Countering can fully cancel the incoming effect.' };
    }
    return { action, label: item.label, score: 260, reason: 'Passing on the counter preserves cards for later.' };
  }

  if (action.type === 'pay_request') {
    const paid = action.cards.reduce((sum, cardId) => sum + moneyValue(cardId), 0);
    return {
      action,
      label: item.label,
      score: 250 - paid,
      reason: 'Prefer lower-cost payment options when resolving debt.' ,
    };
  }

  if (action.type === 'play_property') {
    const actor = state.players.find((entry) => entry.id === actorId);
    const beforeSets = actor ? getSetCompletionCount(actor) : 0;
    const card = getCardDefinition(action.cardId);
    const base = card.kind === 'property' ? 420 : 340;
    const completionBonus = beforeSets >= 2 ? 180 : 40;
    return {
      action,
      label: item.label,
      score: base + completionBonus,
      reason: 'Playing property directly improves set progress and win pressure.' ,
    };
  }

  if (action.type === 'move_wild') {
    return {
      action,
      label: item.label,
      score: 360,
      reason: 'Moving a wild can optimize set completion and future rent value.' ,
    };
  }

  if (action.type === 'play_to_bank') {
    const value = moneyValue(action.cardId);
    return {
      action,
      label: item.label,
      score: 200 + value * 6,
      reason: 'Banking increases payment resilience and future spend flexibility.' ,
    };
  }

  if (action.type === 'play_action') {
    const card = getCardDefinition(action.cardId);
    const kind = card.actionKind;
    const actionKindScore: Record<string, number> = {
      deal_breaker: 650,
      forced_deal: 560,
      sly_deal: 500,
      debt_collector: 450,
      birthday: 430,
      rent: 410,
      rent_wild: 410,
      just_say_no: 230,
      pass_go: 380,
      house: 360,
      hotel: 330,
      double_rent: 340,
    };
    const score = (kind ? actionKindScore[kind] : 300) + (item.requiresPropertyTransfer ? 40 : 0);
    return {
      action,
      label: item.label,
      score,
      reason: card.name + ' is a high-leverage action in this position.',
    };
  }

  if (action.type === 'sly_deal_pick' || action.type === 'forced_deal_pick' || action.type === 'deal_breaker_pick') {
    return {
      action,
      label: item.label,
      score: 520,
      reason: 'Resolving a targeted property selection can swing set control.' ,
    };
  }

  if (action.type === 'pass_turn') {
    const maxPlaysPerTurn = state.ruleset?.maxPlaysPerTurn ?? DEFAULT_RULESET.maxPlaysPerTurn;
    const playBudgetSpent = state.turn.playsUsed >= maxPlaysPerTurn;
    const base = playBudgetSpent ? 210 : 20;
    return {
      action,
      label: item.label,
      score: base,
      reason: playBudgetSpent ? 'Play budget is spent; passing is efficient.' : 'Passing early can avoid overextending.' ,
    };
  }

  return {
    action,
    label: item.label,
    score: 100,
    reason: 'Fallback strategic baseline.',
  };
}

export function rankHeuristicActions(state: GameState, actorId: PlayerId, legalActions: LegalAction[]): ScoredAction[] {
  return legalActions
    .map((item) => actionScore(state, actorId, item))
    .sort((left, right) => right.score - left.score);
}

export function chooseHeuristicAction(state: GameState, actorId: PlayerId, legalActions: LegalAction[]): ScoredAction | null {
  if (legalActions.length === 0) return null;
  const ranked = rankHeuristicActions(state, actorId, legalActions);
  const top = ranked[0];
  const actorStrength = currentPlayerScore(state, actorId);
  if (top.action.type === 'pass_turn' && actorStrength < 180) {
    const better = ranked.find((entry) => entry.action.type !== 'pass_turn');
    if (better) return better;
  }
  return top;
}
