import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeckPicker } from '../ui/godMode/DeckPicker';
import { GOD_MODE_HOLD_MS, godModeAppliesToLocalSeat, godModeOwnerForLocalGame, useTableHold } from '../ui/godMode/godMode';

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

  it('fires after a still five-second hold on the background', () => {
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
    act(() => vi.advanceTimersByTime(GOD_MODE_HOLD_MS - 1000));
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
    fireEvent.click(screen.getByRole('option', { name: '$3 Money' }));
    expect(draw).toBeDisabled();
    fireEvent.click(screen.getByRole('option', { name: '$1 Money' }));
    fireEvent.click(draw);
    expect(onConfirm).toHaveBeenCalledWith(['money_3#c', 'money_1#a']);
  });

  it('shows actions, then money, then properties, each grouped', () => {
    render(<DeckPicker pile={['red_1#a', 'money_1#b', 'pass_go#c', 'money_5#d', 'brown_1#e']} count={2} variant="classic" onConfirm={() => {}} onCancel={() => {}} />);
    const titles = screen.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent);
    expect(titles).toEqual(['Actions 1', 'Money 2', 'Properties 2']);
    const order = screen.getAllByRole('option').map((option) => option.getAttribute('aria-label'));
    expect(order).toEqual(['Pass Go', '$5 Money', '$1 Money', 'Brown Property', 'Red Property']);
  });

  it('asks for fewer cards when the deck is short', () => {
    render(<DeckPicker pile={['money_1#a']} count={2} variant="classic" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: 'Draw 1' })).toBeInTheDocument();
  });
});

describe('god mode ownership', () => {
  const players = [
    { id: 'p1', name: 'Eric', controller: 'human' as const },
    { id: 'p2', name: 'Anna', controller: 'human' as const },
    { id: 'p3', name: 'Hugo', controller: 'bot' as const },
  ];

  it('belongs to the human whose turn it is, or the first human while a bot moves', () => {
    expect(godModeOwnerForLocalGame(players, 1)).toBe('anna');
    expect(godModeOwnerForLocalGame(players, 2)).toBe('eric');
  });

  it("never opens the deck on another player's draw at a shared table", () => {
    expect(godModeAppliesToLocalSeat('eric', players, 'p1')).toBe(true);
    expect(godModeAppliesToLocalSeat('eric', players, 'p2')).toBe(false);
    expect(godModeAppliesToLocalSeat('eric', players, 'p3')).toBe(false);
    // Switched on before owners were kept: only a game with one human seat counts.
    expect(godModeAppliesToLocalSeat(null, players, 'p1')).toBe(false);
    expect(godModeAppliesToLocalSeat(null, [players[0], players[2]], 'p1')).toBe(true);
  });
});
