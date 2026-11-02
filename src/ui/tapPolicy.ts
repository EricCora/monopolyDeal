import { getCardDefinition, type GameVariant } from '../cards/catalog';
import type { Action } from '../engine/types';

/** How a card was activated. A mis-tap only really happens with a finger. */
export type CardInput = 'touch' | 'pointer';

/**
 * Whether a card with one legal option should still ask first. One tap plays money and
 * properties; on a touch screen anything costlier to misplay, such as an action card whose
 * only option is the Bank, a discard or a debt repayment, opens the chooser. Mirrors
 * `TableActions.tapHandCard` in the iOS app.
 */
export function shouldAskFirst(cardId: string, action: Action, input: CardInput, variant: GameVariant): boolean {
  if (input !== 'touch') return false;
  const { kind } = getCardDefinition(cardId, variant);
  const oneTap = kind === 'money' || kind === 'property' || kind === 'wild';
  return !oneTap || action.type === 'discard_card' || action.type === 'repay_debt';
}
