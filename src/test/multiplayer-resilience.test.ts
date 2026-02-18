import { describe, expect, it } from 'vitest';
import { computePushRetryDelayMs } from '../app/multiplayerResilience';

describe('computePushRetryDelayMs', () => {
  it('starts at one second and grows exponentially', () => {
    expect(computePushRetryDelayMs(1)).toBe(1_000);
    expect(computePushRetryDelayMs(2)).toBe(2_000);
    expect(computePushRetryDelayMs(3)).toBe(4_000);
  });

  it('caps retries at the maximum delay', () => {
    expect(computePushRetryDelayMs(6)).toBe(15_000);
    expect(computePushRetryDelayMs(20)).toBe(15_000);
  });

  it('falls back safely for invalid attempts', () => {
    expect(computePushRetryDelayMs(0)).toBe(1_000);
    expect(computePushRetryDelayMs(Number.NaN)).toBe(1_000);
  });
});
