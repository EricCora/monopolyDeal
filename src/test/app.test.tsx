import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../App';

describe('App', () => {
  it('can start a new game from setup', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /new game/i }));
    fireEvent.click(screen.getByRole('button', { name: /start match/i }));

    expect(screen.getByText(/game table/i)).toBeInTheDocument();
    expect(screen.getByText(/legal actions/i)).toBeInTheDocument();
  });
});
