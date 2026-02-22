import { describe, expect, it } from 'vitest';
import { redactSensitiveToken } from '../../apps/server/src/logging.ts';

describe('server logging redaction', () => {
  it('masks reconnect tokens in logs', () => {
    expect(redactSensitiveToken('')).toBe('***');
    expect(redactSensitiveToken('abc')).toBe('***');
    expect(redactSensitiveToken('abcdef')).toBe('***');
    expect(redactSensitiveToken('abcdefg')).toBe('ab***fg');
    expect(redactSensitiveToken('resume-token-12345')).toBe('re***45');
  });
});
