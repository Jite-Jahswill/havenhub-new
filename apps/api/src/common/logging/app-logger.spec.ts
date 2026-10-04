import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppLogger } from './app-logger';
import { requestContextMiddleware, runInJobContext } from './request-context';

function capture() {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  return { lines, restore: () => (spy.mockRestore(), errSpy.mockRestore()) };
}

/** Runs `fn` inside a request context, as the API's first middleware does. */
function inRequest(id: string | undefined, fn: () => void) {
  const headers: Record<string, string> = id ? { 'x-request-id': id } : {};
  const setHeader = vi.fn();
  const res = { setHeader, on: vi.fn(), statusCode: 200 } as unknown as Response;
  requestContextMiddleware({ headers, method: 'GET', originalUrl: '/x' } as Request, res, fn);
  return setHeader;
}

afterEach(() => vi.restoreAllMocks());

describe('AppLogger', () => {
  it('writes one JSON object per line in production, with level, time, context and request id', () => {
    const logger = new AppLogger({ production: true });
    const out = capture();
    try {
      inRequest('req-abc-12345', () =>
        logger.warn(
          'Payment verification failed',
          { event: 'payment.verification_failed', reference: 'HHP-1' },
          'Payments',
        ),
      );
    } finally {
      out.restore();
    }
    expect(out.lines).toHaveLength(1);
    const entry = JSON.parse(out.lines[0]!) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'warn',
      context: 'Payments',
      message: 'Payment verification failed',
      requestId: 'req-abc-12345',
      event: 'payment.verification_failed',
      reference: 'HHP-1',
    });
    expect(typeof entry.timestamp).toBe('number');
  });

  it('redacts sensitive keys at any depth', () => {
    const logger = new AppLogger({ production: true });
    const out = capture();
    try {
      logger.log('Something happened', {
        event: 'x',
        password: 'hunter2',
        refreshToken: 'rt-secret',
        nested: {
          authorization: 'Bearer abc',
          cookie: 'hh_at=1',
          signature: 'sig',
          body: { a: 1 },
        },
      });
    } finally {
      out.restore();
    }
    const line = out.lines.join('');
    for (const secret of ['hunter2', 'rt-secret', 'Bearer abc', 'hh_at=1', '"sig"']) {
      expect(line).not.toContain(secret);
    }
    expect(line).toContain('[REDACTED]');
  });

  it('carries the job name and run id for background work', async () => {
    const logger = new AppLogger({ production: true });
    const out = capture();
    try {
      await runInJobContext('bookings.sweep', () => {
        logger.error('Background job failed', { event: 'job.failed' });
        return Promise.resolve();
      });
    } finally {
      out.restore();
    }
    const entry = JSON.parse(out.lines[0]!) as Record<string, unknown>;
    expect(entry).toMatchObject({ level: 'error', job: 'bookings.sweep', event: 'job.failed' });
    expect(entry.runId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('stays quiet at debug level in production, readable text in development', () => {
    const prod = new AppLogger({ production: true });
    const dev = new AppLogger({ production: false });
    const out = capture();
    try {
      prod.debug('noise');
      inRequest('req-dev-12345', () => dev.log('hello', { event: 'y' }));
    } finally {
      out.restore();
    }
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).toContain('hello');
    expect(out.lines[0]).toContain('req-dev-12345');
    expect(() => {
      JSON.parse(out.lines[0]!);
    }).toThrow();
  });
});

describe('requestContextMiddleware', () => {
  it('keeps a valid incoming id, generates one otherwise, and echoes it', () => {
    const kept = inRequest('edge-request-1234', () => undefined);
    expect(kept).toHaveBeenCalledWith('X-Request-Id', 'edge-request-1234');
    for (const bad of [undefined, 'bad id with spaces', 'x'.repeat(300)]) {
      const setHeader = inRequest(bad, () => undefined);
      const [name, value] = setHeader.mock.calls[0] as [string, string];
      expect(name).toBe('X-Request-Id');
      expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});
