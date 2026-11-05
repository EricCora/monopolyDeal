/**
 * Names bots go by instead of "Player N". A local seat always gets the same
 * one, so its lifetime stats stay under one name. Matches `BotNames.swift`.
 */
export const BOT_NAMES = ['Ada', 'Milo', 'Rosa', 'Otis', 'Ivy', 'Hugo', 'Mabel', 'Felix'] as const;

export function defaultSeatName(index: number): string {
  return `Player ${index + 1}`;
}

export function seatBotName(index: number): string {
  return BOT_NAMES[index % BOT_NAMES.length];
}

/** The name a seat should show after its controller changes, keeping any name someone typed. */
export function seatNameForController(name: string, index: number, controller: 'human' | 'bot'): string {
  const trimmed = name.trim();
  if (controller === 'bot') return !trimmed || trimmed === defaultSeatName(index) ? seatBotName(index) : name;
  return trimmed === seatBotName(index) ? defaultSeatName(index) : name;
}

/** The first bot name nobody at the table has, for bots added to a room or nearby table. */
export function nextBotName(taken: readonly string[]): string {
  const used = new Set(taken.map((name) => name.trim().toLowerCase()));
  return BOT_NAMES.find((name) => !used.has(name.toLowerCase())) ?? BOT_NAMES[0];
}
