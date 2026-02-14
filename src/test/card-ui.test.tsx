import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PROPERTY_RENT_SCALES, PROPERTY_SET_SIZES } from '../cards/catalog';
import { CardView } from '../ui/components/CardView';
import { HandFan } from '../ui/components/HandFan';
import { RulesDrawer } from '../ui/components/RulesDrawer';
import { getCardVisualModel } from '../ui/cards';

describe('Card UI', () => {
  it('renders property, action, money, and wild card faces', () => {
    render(
      <>
        <CardView cardId="brown_1#1" />
        <CardView cardId="debt_collector#1" />
        <CardView cardId="money_5#1" />
        <CardView cardId="wild_red_yellow#1" />
      </>,
    );

    expect(screen.getByRole('button', { name: /brown card/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /debt collector card/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\$5 card/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /wild red\/yellow card/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/rent ladder/i)).toBeInTheDocument();
    expect(screen.getByText(/^rent$/i)).toBeInTheDocument();
    expect(screen.getByText('$2')).toBeInTheDocument();
  });

  it('uses dedicated rent card themes instead of generic action blue', () => {
    render(
      <>
        <CardView cardId="rent_color#1" />
        <CardView cardId="rent_pink_orange#1" />
      </>,
    );

    expect(screen.getByRole('button', { name: /rent \(any color\) card/i })).toHaveClass('theme-rent-any');
    expect(screen.getByRole('button', { name: /rent pink\/orange card/i })).toHaveClass('theme-rent-wild');
  });

  it('renders card back when face down', () => {
    render(<CardView cardId="money_1#1" faceUp={false} />);

    expect(screen.getByRole('button', { name: /hidden card/i })).toBeInTheDocument();
  });

  it('maps every property color to the matching theme and CSS variable', () => {
    const cases = [
      { cardId: 'brown_1#1', themeClass: 'theme-brown', accent: 'var(--card-color-brown)' },
      { cardId: 'light_blue_1#1', themeClass: 'theme-light-blue', accent: 'var(--card-color-light-blue)' },
      { cardId: 'pink_1#1', themeClass: 'theme-pink', accent: 'var(--card-color-pink)' },
      { cardId: 'orange_1#1', themeClass: 'theme-orange', accent: 'var(--card-color-orange)' },
      { cardId: 'red_1#1', themeClass: 'theme-red', accent: 'var(--card-color-red)' },
      { cardId: 'yellow_1#1', themeClass: 'theme-yellow', accent: 'var(--card-color-yellow)' },
      { cardId: 'green_1#1', themeClass: 'theme-green', accent: 'var(--card-color-green)' },
      { cardId: 'dark_blue_1#1', themeClass: 'theme-dark-blue', accent: 'var(--card-color-dark-blue)' },
      { cardId: 'railroad_1#1', themeClass: 'theme-railroad', accent: 'var(--card-color-railroad)' },
      { cardId: 'utility_1#1', themeClass: 'theme-utility', accent: 'var(--card-color-utility)' },
    ];

    for (const testCase of cases) {
      const model = getCardVisualModel(testCase.cardId);
      expect(model.themeClass).toBe(testCase.themeClass);
      expect(model.accent).toBe(testCase.accent);
    }
  });

  it('highlights the full-set rent step for property cards', () => {
    const { container } = render(<CardView cardId="railroad_1#1" />);
    const fullSetSteps = container.querySelectorAll('.card-rent-step.is-fullset');

    expect(fullSetSteps.length).toBe(1);
    expect(fullSetSteps[0]?.textContent).toContain('$4');
  });

  it('uses auto fit mode for fan/rail hand layout based on available width', async () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
    const baseRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
    rectSpy.mockImplementation(function mockRect(this: HTMLElement) {
      if (this.classList?.contains('hand-fan') && this.childElementCount <= 6) {
        return { ...baseRect, width: 620, right: 620, bottom: 200, height: 200 } as DOMRect;
      }
      if (this.classList?.contains('hand-fan')) {
        return { ...baseRect, width: 260, right: 260, bottom: 200, height: 200 } as DOMRect;
      }
      return { ...baseRect } as DOMRect;
    });

    const cards = ['money_1#a', 'money_2#b', 'money_3#c', 'money_4#d', 'money_5#e', 'money_10#f'];
    const allPlayable = new Set(cards);
    const { rerender } = render(
      <HandFan cards={cards} playableCardIds={allPlayable} selectedCardId={null} onCardClick={() => undefined} interactive fitMode="auto" />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/player hand/i)).toHaveAttribute('data-layout', 'fan');
    });

    const moreCards = [...cards, 'brown_1#g', 'light_blue_1#h', 'pink_1#i', 'orange_1#j'];
    rerender(
      <HandFan cards={moreCards} playableCardIds={new Set(moreCards)} selectedCardId={null} onCardClick={() => undefined} interactive fitMode="auto" />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/player hand/i)).toHaveAttribute('data-layout', 'rail');
    });
    rectSpy.mockRestore();
  });

  it('shows rent and set references from the card catalog in the rules drawer', () => {
    render(<RulesDrawer onClose={() => undefined} />);
    const brownRent = PROPERTY_RENT_SCALES.brown.join(' / ');
    const brownRow = screen.getByText('Brown').closest('tr');

    expect(screen.getByRole('dialog', { name: /rules reference/i })).toBeInTheDocument();
    expect(brownRow).not.toBeNull();
    expect(within(brownRow as HTMLElement).getByText(String(PROPERTY_SET_SIZES.brown))).toBeInTheDocument();
    expect(within(brownRow as HTMLElement).getByText(brownRent)).toBeInTheDocument();
  });
});
