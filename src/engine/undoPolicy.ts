import type { GameState } from './types';

/** Free moves like Wild swaps snapshot the whole game, so a turn's undo history needs a ceiling. */
const MAX_TURN_SNAPSHOTS = 32;

/**
 * True when an action other than the turn's forced draw changed the deck. Those
 * cards are now known, so undoing the action would be a free peek. This compares
 * contents because a reshuffle during the draw can leave the count unchanged.
 */
export function actionRevealedDeckCards(before: GameState, after: GameState, actionType: string): boolean {
  if (actionType === 'draw_cards') return false;
  return after.drawPile.length !== before.drawPile.length
    || after.drawPile.some((cardId, index) => cardId !== before.drawPile[index]);
}

/** Drops the oldest step past the cap, but keeps the first entry, which Reset Turn restores. */
export function appendTurnSnapshot<T>(snapshots: T[], snapshot: T): T[] {
  const next = [...snapshots, snapshot];
  if (next.length > MAX_TURN_SNAPSHOTS) next.splice(1, 1);
  return next;
}
