import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TurnOrderCard } from '../ui/screens/TurnOrderCard';
import { dropIndex, moveSeat } from '../ui/screens/turnOrder';

const seats = [
  { id: 'p1', name: 'Eric', isHost: true },
  { id: 'p2', name: 'Robo', isBot: true },
  { id: 'p3', name: 'Anna' },
];

describe('turn order card', () => {
  it('moves a seat to a new place', () => {
    expect(moveSeat(['p1', 'p2', 'p3'], 1, 2)).toEqual(['p1', 'p3', 'p2']);
    expect(moveSeat(['p1', 'p2', 'p3'], 2, 0)).toEqual(['p3', 'p1', 'p2']);
    expect(moveSeat(['p1', 'p2'], 0, 5)).toEqual(['p1', 'p2']);
  });

  it('drops a dragged row past every row whose middle it crossed', () => {
    const middles = [20, 70, 120];
    expect(dropIndex(middles, 0, 10)).toBe(0);
    expect(dropIndex(middles, 0, 60)).toBe(1);
    expect(dropIndex(middles, 0, 200)).toBe(2);
    expect(dropIndex(middles, 2, -110)).toBe(0);
  });

  it('lists seats in turn order and sends the whole new order from the arrows', () => {
    const onReorder = vi.fn();
    render(<TurnOrderCard seats={seats} onReorder={onReorder} />);
    expect(screen.getAllByRole('listitem').map((row) => row.getAttribute('data-seat-id'))).toEqual(['p1', 'p2', 'p3']);
    fireEvent.click(screen.getByRole('button', { name: 'Move Robo later' }));
    expect(onReorder).toHaveBeenCalledWith(['p1', 'p3', 'p2']);
    expect(screen.getByRole('button', { name: 'Move Eric earlier' })).toBeDisabled();
  });

  it('follows the server when a seat joins', () => {
    const { rerender } = render(<TurnOrderCard seats={seats.slice(0, 2)} onReorder={vi.fn()} />);
    rerender(<TurnOrderCard seats={seats} onReorder={vi.fn()} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});
