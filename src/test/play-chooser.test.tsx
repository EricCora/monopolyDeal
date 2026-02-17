import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlayChooser } from '../ui/components/PlayChooser';

describe('PlayChooser', () => {
  it('renders numbered options and color-highlighted label tokens', () => {
    render(
      <PlayChooser
        cardId="wild_all#1"
        cardLabel="Wild Any"
        options={[
          { id: 'a', label: 'Play Wild Any to Light Blue' },
          { id: 'b', label: 'Play Wild Any to Green' },
        ]}
        onChoose={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
    expect(document.querySelector('.action-color-token.is-any')?.textContent).toMatch(/any/i);
    expect(document.querySelector('.action-color-token.is-light-blue')?.textContent).toMatch(/light blue/i);
  });
});
