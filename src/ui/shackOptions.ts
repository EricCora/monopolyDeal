import type { LegalAction } from '../engine';

/**
 * No Mercy lists a Shack once per property it could attach to, so a three-card set offers
 * the same choice three times. The player is picking a set, not a card, so keep the first
 * placement for each set. Mirrors `TableActions.options(forHandCard:)` in the iOS app.
 */
export function collapseShackPlacements(actions: LegalAction[]): LegalAction[] {
  const seen = new Set<string>();
  return actions.filter((item) => {
    const { action } = item;
    if (action.type !== 'play_property' || !action.attachedToCardId) return true;
    const key = `${action.cardId}|${action.color}|${action.setId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
