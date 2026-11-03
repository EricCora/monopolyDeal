import { describe, expect, it } from 'vitest';
import { CENTRE, VIEWER_AREA, onFelt, pileGrid, pillFrame, rectsIntersect, seatBounds, seatCorners, tableSeats } from '../ui/table/seatLayout';

// The same cases as apps/ios/DealKit/Tests/DealKitTests/TableLayoutTests.swift.
describe('seat layout', () => {
  it("keeps every seat's piles on the felt", () => {
    for (let opponents = 1; opponents <= 4; opponents += 1) {
      tableSeats(opponents).forEach((seat, index) => {
        for (const corner of seatCorners(seat)) {
          expect(onFelt(corner), `${opponents + 1} players, seat ${index}`).toBe(true);
        }
      });
    }
    const { x, y, width, height } = VIEWER_AREA;
    for (const corner of [{ x, y }, { x: x + width, y }, { x, y: y + height }, { x: x + width, y: y + height }]) {
      expect(onFelt(corner)).toBe(true);
    }
  });

  it('overlaps nothing', () => {
    for (let opponents = 1; opponents <= 4; opponents += 1) {
      const seats = tableSeats(opponents);
      expect(seats).toHaveLength(opponents);
      const fixed = [CENTRE, VIEWER_AREA, ...seats.map(pillFrame)];
      seats.forEach((seat, index) => {
        for (const frame of fixed) expect(rectsIntersect(seatBounds(seat), frame), `${opponents + 1} players, seat ${index}`).toBe(false);
        seats.slice(index + 1).forEach((other) => expect(rectsIntersect(seatBounds(seat), seatBounds(other))).toBe(false));
      });
    }
  });

  it('turns piles to face their owner', () => {
    expect(tableSeats(1).map((seat) => seat.rotation)).toEqual([180]);
    expect(tableSeats(2).map((seat) => seat.rotation)).toEqual([90, -90]);
    expect(tableSeats(3).map((seat) => seat.rotation)).toEqual([90, 180, -90]);
    expect(tableSeats(4).map((seat) => seat.rotation)).toEqual([90, 166, 194, -90]);
  });

  it('shrinks cards to fit more piles', () => {
    const area = { width: 156, height: 110 };
    expect(pileGrid(3, 3, area).cardWidth).toBeCloseTo(46, 0);
    const six = pileGrid(6, 2, area).cardWidth;
    expect(six).toBeLessThan(46);
    expect(six).toBeGreaterThan(20);
    expect(pileGrid(9, 3, area).cardWidth).toBeLessThanOrEqual(six);
  });
});
