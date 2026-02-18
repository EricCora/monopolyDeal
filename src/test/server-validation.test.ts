import { describe, expect, it } from 'vitest';
import { isNonEmptyTrimmedString } from '../../apps/server/src/validation';

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
});
