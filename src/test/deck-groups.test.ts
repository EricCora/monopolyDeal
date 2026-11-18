import { describe, expect, it } from 'vitest';
import { CARD_DEFINITIONS, NO_MERCY_CARD_DEFINITIONS, type CardDefinition } from '../cards/catalog';
import { groupDeckForPicker } from '../ui/godMode/deckGroups';

const fullDeck = (definitions: CardDefinition[]) => definitions.flatMap((card) => Array.from({ length: card.quantity }, (_, index) => `${card.id}#${index}`));

describe('deck picker groups', () => {
  it('orders sections as actions, money, properties and loses no card', () => {
    for (const [variant, definitions] of [['classic', CARD_DEFINITIONS], ['no_mercy', NO_MERCY_CARD_DEFINITIONS]] as const) {
      const pile = fullDeck(definitions).reverse();
      const sections = groupDeckForPicker(pile, variant);
      expect(sections.map((section) => section.key)).toEqual(['action', 'money', 'property']);
      const ids = sections.flatMap((section) => section.groups.flatMap((group) => group.cards.map((card) => card.cardId)));
      expect([...ids].sort()).toEqual([...pile].sort());
      // Every group appears once, so cards of a kind always sit together.
      const keys = sections.flatMap((section) => section.groups.map((group) => `${section.key}:${group.key}`));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('groups properties by board color, plain cards before wilds, any-color wilds last', () => {
    const pile = ['wild_all#0', 'red_1#0', 'wild_blue_green#0', 'brown_1#0', 'wild_brown_light_blue#0', 'dark_blue_1#0', 'green_1#0'];
    const [properties] = groupDeckForPicker(pile, 'classic');
    expect(properties.groups.map((group) => [group.label, group.cards.map((card) => card.cardId)])).toEqual([
      ['Brown', ['brown_1#0', 'wild_brown_light_blue#0']],
      ['Red', ['red_1#0']],
      ['Green', ['green_1#0', 'wild_blue_green#0']],
      ['Dark Blue', ['dark_blue_1#0']],
      ['Any color', ['wild_all#0']],
    ]);
  });

  it('puts money biggest first and rents in board-color order', () => {
    const sections = groupDeckForPicker(['money_1#0', 'rent_color#0', 'money_10#0', 'rent_red_yellow#0', 'rent_brown_light_blue#0', 'money_1#1'], 'classic');
    const [actions, money] = sections;
    expect(actions.groups).toEqual([{ key: 'rent', label: 'Rent', cards: [
      { cardId: 'rent_brown_light_blue#0', drawIndex: 4 },
      { cardId: 'rent_red_yellow#0', drawIndex: 3 },
      { cardId: 'rent_color#0', drawIndex: 1 },
    ] }]);
    expect(money.groups.map((group) => group.label)).toEqual(['$10M', '$1M']);
    // Matching cards keep their draw order.
    expect(money.groups[1].cards.map((card) => card.drawIndex)).toEqual([0, 5]);
  });
});
