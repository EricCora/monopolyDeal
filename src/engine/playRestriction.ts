import { getCardDefinition, type ActionKind, type GameVariant, type PropertyColor } from '../cards/catalog';
import { discardableCards, isCompletePropertySet, propertySets, type PropertySetView } from './core';
import { getLegalActions, getNextPrompt, isGameOver } from './game';
import type { GameState, PlayerId, PlayerState } from './types';

const BUILDABLE_COLORS: PropertyColor[] = ['brown', 'light_blue', 'pink', 'orange', 'red', 'yellow', 'green', 'dark_blue'];

function holdsBuilding(set: PropertySetView, building: ActionKind, variant: GameVariant): boolean {
  return set.entries.some((entry) => getCardDefinition(entry.cardId, variant).actionKind === building);
}

function buildingRestriction(player: PlayerState, kind: 'house' | 'hotel', variant: GameVariant): string {
  const name = kind === 'house' ? 'House' : 'Hotel';
  const buildable = BUILDABLE_COLORS.flatMap((color) => (
    propertySets(player, color, variant).filter((set) => isCompletePropertySet(set.entries, color, variant))
  ));
  if (buildable.length === 0) {
    const onlyUnbuildable = (['railroad', 'utility'] as PropertyColor[]).some((color) => (
      propertySets(player, color, variant).some((set) => isCompletePropertySet(set.entries, color, variant))
    ));
    return onlyUnbuildable ? "Houses and Hotels can't go on Railroads or Utilities." : `A ${name} needs a complete set.`;
  }
  if (kind === 'hotel' && !buildable.some((set) => holdsBuilding(set, 'house', variant))) {
    return 'A Hotel needs a complete set with a House on it.';
  }
  return `Each complete set can hold only one ${name}.`;
}

/**
 * Why this card can't be used for what it's meant for right now, in words for the player.
 * Null when there's nothing to explain. An action card can usually still be banked, so a
 * reason doesn't always mean the card has no options. Mirrors `PlayRestriction.swift`.
 */
export function playRestriction(state: GameState, playerId: PlayerId, cardId: string): string | null {
  const variant: GameVariant = state.variant ?? 'classic';
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player || isGameOver(state).done) return null;

  const prompt = getNextPrompt(state);
  if (prompt.playerId !== playerId) {
    const name = state.players.find((entry) => entry.id === prompt.playerId)?.name ?? 'another player';
    return `It's ${name}'s turn.`;
  }
  if (prompt.kind === 'discard') {
    return discardableCards(state, player).includes(cardId) || !player.hand.includes(cardId)
      ? null
      : 'Discard your other cards first. Properties go only when nothing else is left.';
  }
  if (prompt.kind === 'debt') return null;
  if (state.pending) return 'Finish the choice in front of you first.';
  if (state.turn.phase === 'draw') return 'Draw your cards first.';
  const limit = state.ruleset?.maxPlaysPerTurn ?? 3;
  if (state.turn.playsUsed >= limit) return `You've used all ${limit} plays this turn.`;

  // Anything it can do beyond the Bank means there's nothing to explain.
  const usable = getLegalActions(state, playerId).some(({ action }) => (
    'cardId' in action && action.cardId === cardId && action.type !== 'play_to_bank'
  ));
  if (usable) return null;

  const card = getCardDefinition(cardId, variant);
  const hasOthers = state.players.length > 1;
  switch (card.actionKind) {
    case 'house':
    case 'hotel':
      return buildingRestriction(player, card.actionKind, variant);
    case 'shack':
      return "A Shack needs a property to sit on that doesn't already have one.";
    case 'just_say_no':
      return 'Save Just Say No to block an action against you.';
    case 'rent':
    case 'rent_wild':
      return "You need a property in one of this card's colors to charge rent. An any-color Wild on its own doesn't count.";
    case 'double_rent':
      return variant === 'classic'
        ? 'Double Rent needs a rent card you can play, and 2 plays left this turn.'
        : "You need a property in one of this card's colors to charge rent. An any-color Wild on its own doesn't count.";
    case 'sly_deal':
      return 'No opponent has a property outside a complete set.';
    case 'forced_deal': {
      const hasMovable = (Object.keys(player.properties) as PropertyColor[]).some((color) => (
        propertySets(player, color, variant).some((set) => !isCompletePropertySet(set.entries, color, variant))
      ));
      return hasMovable ? 'No opponent has a property outside a complete set.' : 'You need a property outside a complete set to swap.';
    }
    case 'deal_breaker':
      return 'No opponent has a complete set.';
    case 'forced_debt':
      return 'Every opponent is already at the limit of debt chips.';
    case 'unfair_trade':
      return 'You need money in your Bank to swap.';
    case 'super_sly_deal':
      return hasOthers ? 'No opponent has any properties to take.' : null;
    default:
      return null;
  }
}
