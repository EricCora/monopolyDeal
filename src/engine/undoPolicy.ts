import type { GameState } from './types';

/**
 * True when an action other than the turn's forced draw took cards off the
 * deck. Those cards are now known, so undoing the action would be a free peek.
 */
export function actionRevealedDeckCards(before: GameState, after: GameState, actionType: string): boolean {
  return actionType !== 'draw_cards' && after.drawPile.length !== before.drawPile.length;
}
