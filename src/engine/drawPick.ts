import { getCardDefinition } from '../cards/catalog';
import type { Action, GameState } from './types';

/**
 * How many cards `action` will draw from the pile, or null when it draws none.
 * Used by god mode to offer a choice of the pile before a draw or Pass Go.
 */
export function drawCountForAction(state: GameState, action: Action): number | null {
  const player = state.players.find((entry) => entry.id === action.playerId);
  if (!player) return null;
  if (action.type === 'draw_cards') return player.hand.length === 0 ? 5 : 2;
  if (action.type !== 'play_action') return null;
  const variant = state.variant === 'no_mercy' ? 'no_mercy' : 'classic';
  const card = getCardDefinition(action.cardId, variant);
  if (card.kind !== 'action' || card.actionKind !== 'pass_go') return null;
  // Pass Go Go Go fills the hand to 7 after the card itself leaves the hand.
  if (variant === 'no_mercy' && card.id === 'pass_go_go_go') return Math.max(0, 7 - (player.hand.length - 1));
  return 2;
}

/** The draw pile from the next card to be drawn to the last. */
export function drawPileInDrawOrder(state: GameState): string[] {
  return [...state.drawPile].reverse();
}

/**
 * The action as a match log keeps it. Every draw names the cards it took, so a draw chosen
 * in god mode looks the same in a replay as any other draw. Replaying the named cards
 * gives the same game, because they are exactly what the draw took from the pile. A draw
 * that reshuffled the discards keeps its plain form, since those cards weren't in the pile yet.
 */
export function actionAsRecorded(before: GameState, after: GameState, action: Action): Action {
  if (action.type !== 'draw_cards' && action.type !== 'play_action') return action;
  if (action.pick !== undefined || drawCountForAction(before, action) == null) return action;
  const had = new Set(before.players.find((player) => player.id === action.playerId)?.hand ?? []);
  const drawn = (after.players.find((player) => player.id === action.playerId)?.hand ?? []).filter((cardId) => !had.has(cardId));
  const pile = new Set(before.drawPile);
  if (drawn.length === 0 || drawn.length > 7 || !drawn.every((cardId) => pile.has(cardId))) return action;
  return { ...action, pick: drawn };
}
