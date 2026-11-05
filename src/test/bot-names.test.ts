import { describe, expect, it } from 'vitest';
import { nextBotName, seatBotName, seatNameForController } from '../ai/botNames';

describe('bot names', () => {
  it('names a bot seat by its position, so it keeps one name across games', () => {
    expect(seatBotName(1)).toBe('Milo');
    expect(seatBotName(1)).toBe(seatBotName(1));
    expect(new Set([0, 1, 2, 3, 4].map(seatBotName)).size).toBe(5);
  });

  it('replaces a default name when a seat becomes a bot, and gives it back', () => {
    expect(seatNameForController('Player 2', 1, 'bot')).toBe('Milo');
    expect(seatNameForController('  ', 1, 'bot')).toBe('Milo');
    expect(seatNameForController('Milo', 1, 'human')).toBe('Player 2');
  });

  it('never replaces a name someone typed', () => {
    expect(seatNameForController('Anna', 1, 'bot')).toBe('Anna');
    expect(seatNameForController('Anna', 1, 'human')).toBe('Anna');
    expect(seatNameForController('Player 3', 1, 'bot')).toBe('Player 3');
  });

  it('picks the first name nobody at the table has', () => {
    expect(nextBotName(['Eric'])).toBe('Ada');
    expect(nextBotName(['Eric', 'ada', 'Milo'])).toBe('Rosa');
  });
});
