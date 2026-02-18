import { describe, expect, it } from 'vitest';
import {
  buildCorsHeaders,
  createCorsPolicy,
  createRateLimiter,
  createRateLimitKey,
  extractClientIp,
  isOriginAllowed,
} from '../../apps/server/src/httpSecurity.ts';

function mockRequest(
  origin?: string,
  forwardedFor?: string,
  remoteAddress = '203.0.113.10',
): { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress: string } } {
  const headers: Record<string, string | string[] | undefined> = {};
  if (origin) headers.origin = origin;
  if (forwardedFor) headers['x-forwarded-for'] = forwardedFor;
  return {
    headers,
    socket: { remoteAddress },
  };
}

describe('multiplayer server CORS policy', () => {
  it('defaults to wildcard mode when allowlist is not set', () => {
    const policy = createCorsPolicy(undefined);
    expect(policy.allowAnyOrigin).toBe(true);
    expect(policy.allowedOrigins).toEqual([]);
  });

  it('normalizes and deduplicates allowlist origins', () => {
    const policy = createCorsPolicy(' https://play.example.com/ , http://localhost:5173,https://play.example.com ');
    expect(policy.allowAnyOrigin).toBe(false);
    expect(policy.allowedOrigins).toEqual(['https://play.example.com', 'http://localhost:5173']);
  });

  it('allows only configured origins in allowlist mode', () => {
    const policy = createCorsPolicy('https://play.example.com');
    expect(isOriginAllowed('https://play.example.com', policy)).toBe(true);
    expect(isOriginAllowed('https://evil.example.com', policy)).toBe(false);
  });

  it('builds vary-by-origin headers when allowlist mode is active', () => {
    const policy = createCorsPolicy('https://play.example.com');
    const headers = buildCorsHeaders('https://play.example.com', policy);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://play.example.com');
    expect(headers.Vary).toBe('Origin');
  });
});

describe('multiplayer server rate limiter', () => {
  it('blocks requests beyond the configured threshold and resets after the window', () => {
    const limiter = createRateLimiter({
      enabled: true,
      windowMs: 1_000,
      maxRequests: 2,
    });

    expect(limiter.allow('203.0.113.1', 0).allowed).toBe(true);
    expect(limiter.allow('203.0.113.1', 100).allowed).toBe(true);

    const blocked = limiter.allow('203.0.113.1', 200);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);

    expect(limiter.allow('203.0.113.1', 1_001).allowed).toBe(true);
  });

  it('can be disabled', () => {
    const limiter = createRateLimiter({
      enabled: false,
      windowMs: 10,
      maxRequests: 1,
    });

    expect(limiter.allow('203.0.113.2', 0).allowed).toBe(true);
    expect(limiter.allow('203.0.113.2', 1).allowed).toBe(true);
    expect(limiter.allow('203.0.113.2', 2).allowed).toBe(true);
  });
});

describe('multiplayer request key extraction', () => {
  it('prefers x-forwarded-for first hop when present', () => {
    const request = mockRequest(undefined, '198.51.100.12, 10.0.0.2');
    expect(extractClientIp(request)).toBe('198.51.100.12');
    expect(createRateLimitKey(request)).toBe('198.51.100.12');
  });

  it('falls back to socket remote address', () => {
    const request = mockRequest(undefined, undefined, '198.51.100.22');
    expect(extractClientIp(request)).toBe('198.51.100.22');
  });
});
