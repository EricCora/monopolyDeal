import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeckPicker } from '../ui/godMode/DeckPicker';
import { GOD_MODE_HOLD_MS, useTableHold } from '../ui/godMode/godMode';

function Table({ onHold }: { onHold: () => void }) {
  const hold = useTableHold(onHold);
  return (
    <section data-testid="table" {...hold}>
      <button type="button">Draw</button>
    </section>
  );
}

describe('table hold', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires after a still ten-second hold on the background', () => {
    const onHold = vi.fn();
    render(<Table onHold={onHold} />);
    fireEvent.pointerDown(screen.getByTestId('table'), { clientX: 10, clientY: 10, pointerId: 1 });
    act(() => vi.advanceTimersByTime(GOD_MODE_HOLD_MS - 1));
    expect(onHold).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it('is cancelled by lifting early, moving, or starting on a button', () => {
    const onHold = vi.fn();
    render(<Table onHold={onHold} />);
    const table = screen.getByTestId('table');
    fireEvent.pointerDown(table, { clientX: 10, clientY: 10, pointerId: 1 });
    act(() => vi.advanceTimersByTime(5000));
    fireEvent.pointerUp(table, { pointerId: 1 });
    fireEvent.pointerDown(table, { clientX: 10, clientY: 10, pointerId: 2 });
    fireEvent.pointerMove(table, { clientX: 60, clientY: 10, pointerId: 2 });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Draw' }), { clientX: 10, clientY: 10, pointerId: 3 });
    act(() => vi.advanceTimersByTime(GOD_MODE_HOLD_MS * 2));
    expect(onHold).not.toHaveBeenCalled();
  });
});

describe('deck picker', () => {
  it('needs exactly the draw count before drawing, in the order chosen', () => {
    const onConfirm = vi.fn();
    render(<DeckPicker pile={['money_1#a', 'money_2#b', 'money_3#c']} count={2} variant="classic" onConfirm={onConfirm} onCancel={() => {}} />);
    const draw = screen.getByRole('button', { name: 'Draw 2' });
    fireEvent.click(screen.getByRole('option', { name: 'Deck card 3' }));
    expect(draw).toBeDisabled();
    fireEvent.click(screen.getByRole('option', { name: 'Deck card 1' }));
    fireEvent.click(draw);
    expect(onConfirm).toHaveBeenCalledWith(['money_3#c', 'money_1#a']);
  });

  it('asks for fewer cards when the deck is short', () => {
    render(<DeckPicker pile={['money_1#a']} count={2} variant="classic" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: 'Draw 1' })).toBeInTheDocument();
  });
});
