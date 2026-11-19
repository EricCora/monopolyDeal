import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => vi.useRealTimers());

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

  it('deletes the game in progress straight away, with no dialog', () => {
    const confirm = vi.spyOn(window, 'confirm');
    const onDeleteInProgress = vi.fn();
    render(
      <SavedGamesScreen
        {...baseProps}
        inProgress={{ variant: 'no_mercy', players: ['You', 'Bot 1'], turn: 3 }}
        onResumeInProgress={noop}
        onDeleteInProgress={onDeleteInProgress}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete No Mercy Game' }));
    expect(onDeleteInProgress).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('offers Undo for six seconds after a delete', () => {
    vi.useFakeTimers();
    const onUndo = vi.fn();
    const onDismissUndo = vi.fn();
    render(
      <SavedGamesScreen
        {...baseProps}
        deletion={{ id: 'd1', label: 'Friday Group' }}
        onUndoDelete={onUndo}
        onDismissUndo={onDismissUndo}
      />,
    );
    const bar = screen.getByRole('status');
    expect(bar.textContent).toContain('Deleted Friday Group');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(5900); });
    expect(onDismissUndo).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(200); });
    expect(onDismissUndo).toHaveBeenCalledTimes(1);
  });

  it('stops the Undo countdown when the screen closes', () => {
    vi.useFakeTimers();
    const onDismissUndo = vi.fn();
    const { unmount } = render(
      <SavedGamesScreen {...baseProps} deletion={{ id: 'd1', label: 'Friday Group' }} onUndoDelete={noop} onDismissUndo={onDismissUndo} />,
    );
    unmount();
    act(() => { vi.advanceTimersByTime(10000); });
    expect(onDismissUndo).not.toHaveBeenCalled();
  });
});
