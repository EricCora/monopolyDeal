import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CardView } from '../ui/components/CardView';

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

  it('renders card back when face down', () => {
    render(<CardView cardId="money_1#1" faceUp={false} />);

    expect(screen.getByRole('button', { name: /hidden card/i })).toBeInTheDocument();
  });
});
