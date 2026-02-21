import { describe, expect, it } from 'vitest';
import {
  isNonEmptyTrimmedString,
  isOptionalFiniteNumber,
  isOptionalNonNegativeInteger,
  isValidMultiplayerAction,
  optionalTrimmedString,
} from '../../apps/server/src/validation';

describe('server validation', () => {
  it('accepts only non-empty trimmed string values', () => {
    expect(isNonEmptyTrimmedString('hello')).toBe(true);
    expect(isNonEmptyTrimmedString('  hello  ')).toBe(true);

    expect(isNonEmptyTrimmedString('')).toBe(false);
    expect(isNonEmptyTrimmedString('   ')).toBe(false);
    expect(isNonEmptyTrimmedString(123)).toBe(false);
    expect(isNonEmptyTrimmedString({ text: 'hello' })).toBe(false);
    expect(isNonEmptyTrimmedString(null)).toBe(false);
    expect(isNonEmptyTrimmedString(undefined)).toBe(false);
  });

  it('normalizes optional trimmed strings and rejects non-strings', () => {
    expect(optionalTrimmedString('  host  ')).toBe('host');
    expect(optionalTrimmedString('')).toBeUndefined();
    expect(optionalTrimmedString('   ')).toBeUndefined();
    expect(optionalTrimmedString(42)).toBeUndefined();
  });

  it('accepts optional numeric guards used by multiplayer endpoints', () => {
    expect(isOptionalNonNegativeInteger(undefined)).toBe(true);
    expect(isOptionalNonNegativeInteger(0)).toBe(true);
    expect(isOptionalNonNegativeInteger(12)).toBe(true);
    expect(isOptionalNonNegativeInteger(-1)).toBe(false);
    expect(isOptionalNonNegativeInteger(1.5)).toBe(false);
    expect(isOptionalNonNegativeInteger('1')).toBe(false);

    expect(isOptionalFiniteNumber(undefined)).toBe(true);
    expect(isOptionalFiniteNumber(0)).toBe(true);
    expect(isOptionalFiniteNumber(-10.5)).toBe(true);
    expect(isOptionalFiniteNumber(Number.NaN)).toBe(false);
    expect(isOptionalFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isOptionalFiniteNumber('5')).toBe(false);
  });

  it('validates multiplayer action payload shapes', () => {
    expect(isValidMultiplayerAction({ type: 'draw_cards', playerId: 'p1' })).toBe(true);
    expect(isValidMultiplayerAction({
      type: 'play_action',
      playerId: 'p1',
      cardId: 'rent_red#abc',
      targetPlayerId: 'p2',
      color: 'red',
    })).toBe(true);
    expect(isValidMultiplayerAction({
      type: 'pay_request',
      playerId: 'p2',
      cards: ['money_2#1', 'brown_1#2'],
    })).toBe(true);
    expect(isValidMultiplayerAction({
      type: 'forced_deal_pick',
      playerId: 'p1',
      giveCardId: 'brown_1#1',
      giveColor: 'brown',
      takeCardId: 'red_1#2',
      takeColor: 'red',
      destinationColor: 'red',
    })).toBe(true);

    expect(isValidMultiplayerAction({ type: 'unknown_action', playerId: 'p1' })).toBe(false);
    expect(isValidMultiplayerAction({ type: 'draw_cards', playerId: '' })).toBe(false);
    expect(isValidMultiplayerAction({ type: 'play_property', playerId: 'p1', cardId: 'x', color: 'magenta' })).toBe(false);
    expect(isValidMultiplayerAction({ type: 'pay_request', playerId: 'p1', cards: [1, 2] })).toBe(false);
    expect(isValidMultiplayerAction({ type: 'counter_response', playerId: 'p1', useJustSayNo: 'yes' })).toBe(false);
    expect(isValidMultiplayerAction({ type: 'deal_breaker_pick', playerId: 'p1', color: 123 })).toBe(false);
  });
});
