/**
 * Where each opponent sits around the table. Mirrors `apps/ios/DealKit/Sources/DealStats/TableLayout.swift`.
 *
 * Everything is in a design space: an oval felt of 388 × 600, with name pills allowed to
 * sit out on the rail. The table scales this to the screen. Each seat's piles fill a box
 * `area` wide (along the rail) and deep (toward the middle), turned by `rotation` degrees
 * so the cards face their owner.
 */
export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; width: number; height: number }

export interface TableSeat {
  center: Point;
  area: Size;
  rotation: number;
  pill: Point;
}

export const FELT: Size = { width: 388, height: 600 };
/** The whole drawing, with room on every side for the rail and the pills on it. */
export const CANVAS: Rect = { x: -30, y: -40, width: 448, height: 676 };
export const PILL_SIZE: Size = { width: 160, height: 44 };
/** The draw pile and the discard, side by side. */
export const CENTRE: Rect = { x: 136, y: 250, width: 116, height: 100 };
/** The viewer's own Bank and sets. */
export const VIEWER_AREA: Rect = { x: 82, y: 366, width: 224, height: 170 };
/** The viewer's name, on the rail below the felt. */
export const VIEWER_PILL: Point = { x: 194, y: 604 };

/** How much of each card under the top one shows, as a share of the card's width. */
export const REVEAL = 0.3;
/** Room under each pile for its label. */
export const LABEL_HEIGHT = 14;
export const PILE_GAP = 8;

const seat = (x: number, y: number, width: number, height: number, rotation: number, pillX: number, pillY: number): TableSeat => ({
  center: { x, y },
  area: { width, height },
  rotation,
  pill: { x: pillX, y: pillY },
});

/**
 * Seats for this many opponents, in turn order after the viewer: left, then around the
 * top, then right. Five players is the most the game allows.
 */
export function tableSeats(opponents: number): TableSeat[] {
  if (opponents < 1) return [];
  if (opponents === 1) return [seat(194, 130, 200, 150, 180, 194, -14)];
  if (opponents === 2) {
    return [seat(84, 251, 200, 100, 90, 84, 120), seat(304, 251, 200, 100, -90, 304, 120)];
  }
  if (opponents === 3) {
    return [seat(84, 268, 156, 100, 90, 84, 162), seat(194, 86, 170, 100, 180, 194, -14), seat(304, 268, 156, 100, -90, 304, 162)];
  }
  return [
    seat(66, 300, 130, 84, 90, 84, 210),
    seat(122, 132, 104, 78, 166, 84, -10),
    seat(266, 132, 104, 78, 194, 304, -10),
    seat(322, 300, 130, 84, -90, 304, 210),
  ];
}

/** The upright box the turned piles take up. */
export function seatBounds(s: TableSeat): Rect {
  const radians = (s.rotation * Math.PI) / 180;
  const width = Math.abs(s.area.width * Math.cos(radians)) + Math.abs(s.area.height * Math.sin(radians));
  const height = Math.abs(s.area.width * Math.sin(radians)) + Math.abs(s.area.height * Math.cos(radians));
  return { x: s.center.x - width / 2, y: s.center.y - height / 2, width, height };
}

/** The four corners of the turned piles' box. */
export function seatCorners(s: TableSeat): Point[] {
  const radians = (s.rotation * Math.PI) / 180;
  const halfWidth = s.area.width / 2;
  const halfHeight = s.area.height / 2;
  return [[-halfWidth, -halfHeight], [halfWidth, -halfHeight], [halfWidth, halfHeight], [-halfWidth, halfHeight]].map(([x, y]) => ({
    x: s.center.x + x * Math.cos(radians) - y * Math.sin(radians),
    y: s.center.y + x * Math.sin(radians) + y * Math.cos(radians),
  }));
}

export function pillFrame(s: TableSeat): Rect {
  return { x: s.pill.x - PILL_SIZE.width / 2, y: s.pill.y - PILL_SIZE.height / 2, ...PILL_SIZE };
}

/** Whether a point lies on the felt, `inset` in from its edge. */
export function onFelt(point: Point, inset = 0): boolean {
  const radiusX = FELT.width / 2 - inset;
  const radiusY = FELT.height / 2 - inset;
  const x = (point.x - FELT.width / 2) / radiusX;
  const y = (point.y - FELT.height / 2) / radiusY;
  return x * x + y * y <= 1;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * The card width that fits `piles` piles into a seat's box, wrapping onto up to three
 * rows, and how many piles go in a row. `tallest` is the most cards in any one pile.
 */
export function pileGrid(piles: number, tallest: number, area: Size, largest = 46): { cardWidth: number; columns: number } {
  if (piles <= 0) return { cardWidth: largest, columns: 1 };
  // A card is 1.4 widths tall, and each card under it shows REVEAL widths more.
  const pileHeight = 1.4 + REVEAL * (Math.max(tallest, 1) - 1);
  let best = { cardWidth: 0, columns: piles };
  for (let rows = 1; rows <= 3; rows += 1) {
    const columns = Math.ceil(piles / rows);
    const byWidth = (area.width - PILE_GAP * (columns - 1)) / columns;
    const byHeight = ((area.height - PILE_GAP * (rows - 1)) / rows - LABEL_HEIGHT) / pileHeight;
    const width = Math.min(largest, byWidth, byHeight);
    if (width > best.cardWidth) best = { cardWidth: width, columns };
  }
  return { cardWidth: Math.max(best.cardWidth, 14), columns: best.columns };
}

/**
 * Maps the design space onto a table `width` × `height` on screen. Positions stretch to
 * fill the space; sizes use the smaller stretch, so nothing grows into its neighbour.
 */
export function tableFrame(width: number, height: number) {
  const sx = width / CANVAS.width;
  const sy = height / CANVAS.height;
  const scale = Math.min(sx, sy);
  const point = (p: Point): Point => ({ x: (p.x - CANVAS.x) * sx, y: (p.y - CANVAS.y) * sy });
  const origin = point({ x: 0, y: 0 });
  return { sx, sy, scale, point, felt: { x: origin.x, y: origin.y, width: FELT.width * sx, height: FELT.height * sy } };
}
