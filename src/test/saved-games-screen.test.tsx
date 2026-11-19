import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SavedGamesScreen } from '../ui/screens/SavedGamesScreen';

const noop = () => {};
const baseProps = {
  slots: [],
  canSaveCurrent: false,
  error: null,
  onSaveCurrentToNewSlot: noop,
  onLoadSlot: noop,
  onSaveToExistingSlot: noop,
  onRenameSlot: noop,
  onDeleteSlot: noop,
  onBack: noop,
};

describe('saved games screen', () => {
  // Reported from the app: Continue Playing showed a game, but See All opened an empty list.
  it('lists the game in progress, so See All never opens to nothing', () => {
    const onResumeInProgress = vi.fn();
    render(
      <SavedGamesScreen
        {...baseProps}
        inProgress={{ variant: 'classic', players: ['You', 'Bot 1', 'Bot 2'], turn: 6 }}
        onResumeInProgress={onResumeInProgress}
      />,
    );
    const row = screen.getByRole('region', { name: 'In Progress' });
    expect(row.textContent).toContain('Classic Game');
    expect(row.textContent).toContain('3 players · Turn 6');
    fireEvent.click(screen.getByRole('button', { name: 'Resume Classic Game' }));
    expect(onResumeInProgress).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('No saved slots yet.')).toBeNull();
  });

  it('shows no in-progress row when there is no game in progress', () => {
    render(<SavedGamesScreen {...baseProps} />);
    expect(screen.queryByRole('region', { name: 'In Progress' })).toBeNull();
    expect(screen.getByText('No saved slots yet.')).toBeTruthy();
  });
});
