import type { IncomingMessage } from 'node:http';

/** Error raised while reading a client request body. */
export class RequestBodyError extends Error {
  readonly statusCode: 400 | 413;
  readonly code: 'invalid_request' | 'payload_too_large';

  constructor(code: 'invalid_request' | 'payload_too_large', statusCode: 400 | 413) {
    super(code);
    this.name = 'RequestBodyError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Read a request body without allowing an unbounded client-controlled buffer.
 * The request is drained after a size violation so the connection can be
 * reused, while aborted/error events reject instead of leaving a pending
 * promise behind.
 */
export function collectBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(req.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      req.resume();
      reject(new RequestBodyError('payload_too_large', 413));
      return;
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const cleanup = () => {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('aborted', onAborted);
      req.removeListener('error', onError);
      req.removeListener('close', onClose);
    };

    const fail = (error: RequestBodyError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > maxBytes) {
        // Stop retaining data, but drain the stream to avoid a socket reset
        // while the 413 response is sent.
        cleanup();
        req.resume();
        fail(new RequestBodyError('payload_too_large', 413));
        return;
      }
      chunks.push(buffer);
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };

    const onAborted = () => fail(new RequestBodyError('invalid_request', 400));
    const onError = () => fail(new RequestBodyError('invalid_request', 400));
    const onClose = () => {
      if (!settled) fail(new RequestBodyError('invalid_request', 400));
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('aborted', onAborted);
    req.on('error', onError);
    req.on('close', onClose);
  });
}

/**
 * Small in-memory sliding-window limiter suitable for a single self-hosted
 * process. It returns the remaining wait in milliseconds when blocked.
 */
export class SlidingWindowRateLimiter {
  private readonly attemptsByKey = new Map<string, number[]>();

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  tryAcquire(key: string, now = Date.now()): number | null {
    const cutoff = now - this.windowMs;
    const recentAttempts = (this.attemptsByKey.get(key) ?? []).filter((timestamp) => timestamp > cutoff);

    if (recentAttempts.length >= this.maxAttempts) {
      this.attemptsByKey.set(key, recentAttempts);
      return Math.max(1, recentAttempts[0] + this.windowMs - now);
    }

    recentAttempts.push(now);
    this.attemptsByKey.set(key, recentAttempts);
    this.pruneKeys(cutoff);
    return null;
  }

  private pruneKeys(cutoff: number): void {
    for (const [key, timestamps] of this.attemptsByKey) {
      if (timestamps.every((timestamp) => timestamp <= cutoff)) this.attemptsByKey.delete(key);
    }
    while (this.attemptsByKey.size > this.maxKeys) {
      const oldestKey = this.attemptsByKey.keys().next().value;
      if (oldestKey === undefined) return;
      this.attemptsByKey.delete(oldestKey);
    }
  }
}
