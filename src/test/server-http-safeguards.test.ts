import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  collectBody,
  RequestBodyError,
  SlidingWindowRateLimiter,
} from '../../apps/server/src/httpSafeguards.ts';

class FakeRequest extends EventEmitter {
  readonly headers: Record<string, string> = {};
  resumed = false;

  resume(): this {
    this.resumed = true;
    return this;
  }
}

describe('server HTTP safeguards', () => {
  it('collects a body up to the configured byte limit', async () => {
    const request = new FakeRequest();
    const bodyPromise = collectBody(request as never, 32);
    request.emit('data', Buffer.from('{"ok":'));
    request.emit('data', Buffer.from('true}'));
    request.emit('end');

    await expect(bodyPromise).resolves.toBe('{"ok":true}');
  });

  it('rejects oversized bodies and drains the request', async () => {
    const request = new FakeRequest();
    const bodyPromise = collectBody(request as never, 4);
    request.emit('data', Buffer.from('12345'));

    await expect(bodyPromise).rejects.toMatchObject({
      code: 'payload_too_large',
      statusCode: 413,
    } satisfies Partial<RequestBodyError>);
    expect(request.resumed).toBe(true);
  });

  it('rejects when the request is aborted before completion', async () => {
    const request = new FakeRequest();
    const bodyPromise = collectBody(request as never, 64);
    request.emit('aborted');

    await expect(bodyPromise).rejects.toMatchObject({
      code: 'invalid_request',
      statusCode: 400,
    });
  });

  it('limits room creation attempts per key and reports the wait', () => {
    const limiter = new SlidingWindowRateLimiter(2, 1_000);

    expect(limiter.tryAcquire('127.0.0.1', 100)).toBeNull();
    expect(limiter.tryAcquire('127.0.0.1', 200)).toBeNull();
    expect(limiter.tryAcquire('127.0.0.1', 300)).toBe(800);
    expect(limiter.tryAcquire('another-client', 300)).toBeNull();
    expect(limiter.tryAcquire('127.0.0.1', 1_101)).toBeNull();
  });
});
