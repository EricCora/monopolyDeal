/** Moves one seat to a new place in the turn order. Out-of-range moves change nothing. */
export function moveSeat(order: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) return order;
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Where a row dragged from `from` lands, given every row's middle when the drag began and how far it has moved. */
export function dropIndex(middles: number[], from: number, deltaY: number): number {
  const middle = middles[from] + deltaY;
  return middles.reduce((index, other, position) => (position !== from && middle > other ? index + 1 : index), 0);
}
