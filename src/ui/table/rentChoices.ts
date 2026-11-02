import { getCardDefinition, type GameVariant } from '../../cards/catalog';
import { getRentAmount, type Action, type GameState } from '../../engine';

interface Choice {
  action: Action;
  description?: string;
}

/** Puts a rent card's colors in order of what they'd earn, and says how much. Other options keep their place. */
export function orderRentChoices<T extends Choice>(choices: T[], game: GameState | null | undefined, playerId: string | undefined, variant: GameVariant): T[] {
  const player = game?.players.find((entry) => entry.id === playerId);
  if (!player) return choices;
  const rentOf = (choice: T): number | null => {
    const { action } = choice;
    if (action.type !== 'play_action' || !action.color) return null;
    const kind = getCardDefinition(action.cardId, variant).actionKind;
    return kind === 'rent' || kind === 'rent_wild' ? getRentAmount(player, action.color, variant) : null;
  };
  const rents = choices
    .map((choice, index) => ({ choice, index, rent: rentOf(choice) }))
    .filter((item): item is { choice: T; index: number; rent: number } => item.rent != null)
    .sort((left, right) => right.rent - left.rent || left.index - right.index);
  let nextRent = 0;
  return choices.map((choice) => {
    if (rentOf(choice) == null) return choice;
    const { choice: placed, rent } = rents[nextRent];
    nextRent += 1;
    return { ...placed, description: `Earns $${rent}. ${placed.description ?? ''}`.trim() };
  });
}
