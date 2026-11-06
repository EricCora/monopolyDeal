import { describe, expect, it } from 'vitest';
import { BOT_NAMES, randomBotName, seatNameForController, startingSeatNames } from '../ai/botNames';

function sequence(...values: number[]) {
  let index = 0;
  return () => values[index++ % values.length];
}

describe('bot names', () => {
  it('draws a different name as the random draw changes', () => {
    expect(randomBotName([], () => 0)).toBe(BOT_NAMES[0]);
    expect(randomBotName([], () => 0.99)).toBe(BOT_NAMES[BOT_NAMES.length - 1]);
  });

  it('never draws a name somebody at the table has', () => {
    const taken = BOT_NAMES.slice(0, -1).map((name) => name.toLowerCase());
    for (const value of [0, 0.3, 0.7, 0.99]) expect(randomBotName(taken, () => value)).toBe(BOT_NAMES[BOT_NAMES.length - 1]);
  });

  it('gives a seat a random name nobody has when it becomes a bot', () => {
    expect(seatNameForController('Player 2', 1, 'bot', ['Eric'], () => 0)).toBe(BOT_NAMES[0]);
    expect(seatNameForController('', 1, 'bot', [BOT_NAMES[0]], () => 0)).toBe(BOT_NAMES[1]);
  });

  it('gives a bot name back as "Player N" when the seat becomes human again', () => {
    expect(seatNameForController(BOT_NAMES[3], 1, 'human')).toBe('Player 2');
    expect(seatNameForController('', 1, 'human')).toBe('Player 2');
  });

  it('never replaces a name someone typed', () => {
    expect(seatNameForController('Anna', 1, 'bot')).toBe('Anna');
    expect(seatNameForController('Anna', 1, 'human')).toBe('Anna');
  });

  it('gives bot seats without a name of their own distinct names at the start', () => {
    const names = startingSeatNames([
      { name: 'Eric', controller: 'human' },
      { name: '', controller: 'bot' },
      { name: 'Player 3', controller: 'bot' },
      { name: 'Anna', controller: 'bot' },
      { name: ' ', controller: 'human' },
    ], sequence(0, 0));
    expect(names).toEqual(['Eric', BOT_NAMES[0], BOT_NAMES[1], 'Anna', 'Player 5']);
  });
});
