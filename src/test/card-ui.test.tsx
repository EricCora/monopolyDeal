import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CardView } from '../ui/components/CardView';
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
    expect(screen.getByText(/set 2/i)).toBeInTheDocument();
    expect(screen.getByText(/rent \$1\/\$2/i)).toBeInTheDocument();
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
});
