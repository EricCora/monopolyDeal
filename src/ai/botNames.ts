/**
 * Names bots go by instead of "Player N", drawn at random each game.
 * Matches `BotNames.swift`.
 */
export const BOT_NAMES = [
  'Ada', 'Milo', 'Rosa', 'Otis', 'Ivy', 'Hugo', 'Mabel', 'Felix',
  'Nora', 'Theo', 'Pearl', 'Gus', 'Clara', 'Jasper', 'Wren', 'Bruno',
] as const;

export function defaultSeatName(index: number): string {
  return `Player ${index + 1}`;
}

/**
 * The name a seat shows after it switches between human and bot. A seat that becomes
 * a bot gets a random name you can then change; one that goes back to human gets
 * "Player N" again if it still had a bot name. A name someone typed is otherwise kept.
 */
export function seatNameForController(
  name: string,
  index: number,
  controller: 'human' | 'bot',
  taken: readonly string[] = [],
  random: () => number = Math.random,
): string {
  const trimmed = name.trim();
  if (controller === 'bot') {
    return !trimmed || trimmed === defaultSeatName(index) ? randomBotName(taken, random) : name;
  }
  return !trimmed || isBotName(trimmed) ? defaultSeatName(index) : name;
}

export function isBotName(name: string): boolean {
  const lowered = name.trim().toLowerCase();
  return BOT_NAMES.some((botName) => botName.toLowerCase() === lowered);
}

/** A random bot name nobody at the table has. */
export function randomBotName(taken: readonly string[], random: () => number = Math.random): string {
  const used = new Set(taken.map((name) => name.trim().toLowerCase()));
  const free = BOT_NAMES.filter((name) => !used.has(name.toLowerCase()));
  const pool = free.length > 0 ? free : BOT_NAMES;
  return pool[Math.floor(random() * pool.length) % pool.length];
}

/** The names seats start a game with: bot seats without a name of their own draw one. */
export function startingSeatNames(
  seats: readonly { name: string; controller: 'human' | 'bot' }[],
  random: () => number = Math.random,
): string[] {
  const names = seats.map((seat, index) => {
    const trimmed = seat.name.trim();
    if (seat.controller === 'bot' && (!trimmed || trimmed === defaultSeatName(index))) return '';
    return trimmed || defaultSeatName(index);
  });
  return names.map((name, index) => {
    if (name) return name;
    const drawn = randomBotName(names, random);
    names[index] = drawn;
    return drawn;
  });
}
