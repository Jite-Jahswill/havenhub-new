import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { parseRequestId, REQUEST_ID_HEADER } from '@havenhub/shared';
import type { NextFunction, Request, Response } from 'express';

import { describeError, framesOf } from './describe-error';

/** Correlation ids for everything logged while handling one request or job run. */
export interface LogContext {
  requestId?: string;
  /** A background job's run (see `runInJobContext`). */
  job?: string;
  runId?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

export const currentLogContext = (): LogContext | undefined => storage.getStore();

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The canonical request id (also sent back as X-Request-Id). */
      requestId?: string;
    }
  }
}

/** Requests at least this slow are logged as warnings. */
export const SLOW_REQUEST_MS = 3_000;

const logger = new Logger('Http');

/** "/api/v1/bookings/:id" when Express matched a route, else null. */
function routeTemplate(req: Request): string | null {
  const route = req.route as { path?: unknown } | undefined;
  return typeof route?.path === 'string' ? `${req.baseUrl ?? ''}${route.path}` : null;
}

/** The request path without its query string (which may carry tokens). */
export const pathOf = (req: Pick<Request, 'originalUrl' | 'url'>): string =>
  (req.originalUrl ?? req.url ?? '').split('?')[0]!;

/**
 * First middleware: gives every request one id — a well-formed incoming
 * X-Request-Id (e.g. forwarded by the web app or the edge) or a new UUID —
 * echoes it in the response, and runs the rest of the request inside a log
 * context so every log line carries it. Only failures (5xx) and slow
 * requests are logged; successful requests stay quiet.
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = parseRequestId(req.headers[REQUEST_ID_HEADER]) ?? randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
    const status = res.statusCode;
    if (status < 500 && durationMs < SLOW_REQUEST_MS) return;
    const fields = {
      event: status >= 500 ? 'http.request.failed' : 'http.request.slow',
      requestId,
      method: req.method,
      route: routeTemplate(req),
      path: pathOf(req),
      status,
      durationMs,
    };
    logger.warn(status >= 500 ? 'Request failed' : 'Slow request', fields);
  });
  storage.run({ requestId }, next);
}

/** Runs a background job with a fresh run id in its log context. */
export function runInJobContext<T>(job: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ job, runId: randomUUID() }, fn);
}

/**
 * One timer tick of a background sweep: runs with a job name and run id in
 * the log context; a failure is logged (never thrown) with both, the error
 * class/code and stack frames, and the sweep retries on its next tick.
 */
export function runSweepTick(
  log: Pick<Logger, 'error'>,
  job: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  return runInJobContext(job, async () => {
    try {
      await fn();
    } catch (error) {
      log.error('Background job failed', {
        event: 'job.failed',
        job,
        runId: currentLogContext()?.runId,
        ...describeError(error),
        stack: framesOf(error),
      });
    }
  });
}
