const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 300;
const DEFAULT_RATE_LIMIT_MAX_CLIENTS = 10_000;

interface RequestHeadersShape {
  headers: Record<string, string | string[] | undefined>;
  socket: {
    remoteAddress?: string | null;
  };
}

export interface CorsPolicy {
  allowAnyOrigin: boolean;
  allowedOrigins: string[];
}

function normalizeOrigin(origin: string): string | null {
  const trimmed = origin.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function createCorsPolicy(rawAllowedOrigins: string | undefined): CorsPolicy {
  if (!rawAllowedOrigins || rawAllowedOrigins.trim().length === 0) {
    return { allowAnyOrigin: true, allowedOrigins: [] };
  }
  const segments = rawAllowedOrigins
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0 || segments.includes('*')) {
    return { allowAnyOrigin: true, allowedOrigins: [] };
  }
  const normalized = new Set<string>();
  for (const segment of segments) {
    const origin = normalizeOrigin(segment);
    if (origin) normalized.add(origin);
  }
  if (normalized.size === 0) {
    return { allowAnyOrigin: true, allowedOrigins: [] };
  }
  return { allowAnyOrigin: false, allowedOrigins: Array.from(normalized) };
}

function normalizeRequestOrigin(originHeader: string | undefined): string | null {
  if (!originHeader) return null;
  return normalizeOrigin(originHeader);
}

export function isOriginAllowed(originHeader: string | undefined, policy: CorsPolicy): boolean {
  if (policy.allowAnyOrigin) return true;
  if (!originHeader) return true;
  const normalized = normalizeRequestOrigin(originHeader);
  if (!normalized) return false;
  return policy.allowedOrigins.includes(normalized);
}

export function buildCorsHeaders(originHeader: string | undefined, policy: CorsPolicy): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (policy.allowAnyOrigin) {
    headers['Access-Control-Allow-Origin'] = '*';
    return headers;
  }

  const normalized = normalizeRequestOrigin(originHeader);
  if (normalized && policy.allowedOrigins.includes(normalized)) {
    headers['Access-Control-Allow-Origin'] = normalized;
  } else if (policy.allowedOrigins.length > 0) {
    headers['Access-Control-Allow-Origin'] = policy.allowedOrigins[0];
  }
  headers.Vary = 'Origin';
  return headers;
}

function sanitizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

export interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
  maxTrackedClients: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSec: number;
  remaining: number;
}

export interface RateLimiter {
  readonly config: RateLimitConfig;
  allow: (clientKey: string, nowMs?: number) => RateLimitDecision;
}

interface RateLimitEntry {
  windowStartMs: number;
  lastSeenMs: number;
  count: number;
}

export function createRateLimiter(rawConfig: Partial<RateLimitConfig>): RateLimiter {
  const config: RateLimitConfig = {
    enabled: rawConfig.enabled !== false,
    windowMs: sanitizePositiveInteger(rawConfig.windowMs, DEFAULT_RATE_LIMIT_WINDOW_MS),
    maxRequests: sanitizePositiveInteger(rawConfig.maxRequests, DEFAULT_RATE_LIMIT_MAX_REQUESTS),
    maxTrackedClients: sanitizePositiveInteger(rawConfig.maxTrackedClients, DEFAULT_RATE_LIMIT_MAX_CLIENTS),
  };
  const entries = new Map<string, RateLimitEntry>();

  const prune = (nowMs: number) => {
    const expirationCutoff = nowMs - config.windowMs;
    for (const [key, entry] of entries) {
      if (entry.lastSeenMs < expirationCutoff) {
        entries.delete(key);
      }
    }
    if (entries.size <= config.maxTrackedClients) return;

    const overflow = entries.size - config.maxTrackedClients;
    const oldestEntries = Array.from(entries.entries())
      .sort((left, right) => left[1].lastSeenMs - right[1].lastSeenMs)
      .slice(0, overflow);
    for (const [key] of oldestEntries) {
      entries.delete(key);
    }
  };

  return {
    config,
    allow: (clientKey: string, nowMs = Date.now()): RateLimitDecision => {
      if (!config.enabled) {
        return {
          allowed: true,
          retryAfterSec: 0,
          remaining: config.maxRequests,
        };
      }

      const normalizedKey = clientKey.trim() || 'unknown';
      prune(nowMs);

      const current = entries.get(normalizedKey);
      if (!current || nowMs - current.windowStartMs >= config.windowMs) {
        entries.set(normalizedKey, {
          windowStartMs: nowMs,
          lastSeenMs: nowMs,
          count: 1,
        });
        return {
          allowed: true,
          retryAfterSec: 0,
          remaining: Math.max(0, config.maxRequests - 1),
        };
      }

      current.lastSeenMs = nowMs;
      if (current.count >= config.maxRequests) {
        const retryAfterMs = Math.max(0, config.windowMs - (nowMs - current.windowStartMs));
        return {
          allowed: false,
          retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
          remaining: 0,
        };
      }

      current.count += 1;
      return {
        allowed: true,
        retryAfterSec: 0,
        remaining: Math.max(0, config.maxRequests - current.count),
      };
    },
  };
}

export function extractClientIp(req: RequestHeadersShape): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const firstHop = forwarded.split(',')[0]?.trim();
    if (firstHop) return firstHop;
  } else if (Array.isArray(forwarded)) {
    for (const value of forwarded) {
      const firstHop = value.split(',')[0]?.trim();
      if (firstHop) return firstHop;
    }
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function createRateLimitKey(req: RequestHeadersShape): string {
  return extractClientIp(req);
}
