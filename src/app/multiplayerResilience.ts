const BASE_PUSH_RETRY_DELAY_MS = 1_000;
const MAX_PUSH_RETRY_DELAY_MS = 15_000;

export function computePushRetryDelayMs(attempt: number): number {
  const normalizedAttempt = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  return Math.min(MAX_PUSH_RETRY_DELAY_MS, BASE_PUSH_RETRY_DELAY_MS * (2 ** (normalizedAttempt - 1)));
}
