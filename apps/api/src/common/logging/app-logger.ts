import { ConsoleLogger, type LogLevel } from '@nestjs/common';

import { currentLogContext } from './request-context';

/** Keys whose values are never written to logs, at any depth. */
export const REDACTED_KEYS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'cookies',
  'secret',
  'signature',
  'apiKey',
  'body',
  'rawBody',
];

/**
 * The application logger: Nest's ConsoleLogger with
 *  - the current request id / job run id added to every line;
 *  - JSON lines in production (one object per line with `level`,
 *    `timestamp` (epoch ms), `context`, `message` and the structured fields
 *    flattened into it), readable text elsewhere;
 *  - sensitive keys redacted from structured fields;
 *  - production levels log/warn/error/fatal (no debug noise).
 */
export class AppLogger extends ConsoleLogger {
  constructor(options: { production: boolean }) {
    const logLevels: LogLevel[] = options.production
      ? ['log', 'warn', 'error', 'fatal']
      : ['log', 'warn', 'error', 'fatal', 'debug', 'verbose'];
    super({
      json: options.production,
      colors: !options.production,
      compact: options.production ? true : 3,
      flattenParams: true,
      structuredParams: true,
      redact: REDACTED_KEYS,
      logLevels,
    });
  }

  protected override printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: LogLevel,
    writeStreamType?: 'stdout' | 'stderr',
    errorStack?: unknown,
    params?: Record<string, unknown>,
  ): void {
    const ctx = currentLogContext();
    const ids = ctx
      ? Object.fromEntries(Object.entries(ctx).filter(([, value]) => value !== undefined))
      : {};
    const merged = Object.keys(ids).length ? { ...ids, ...(params ?? {}) } : params;
    super.printMessages(messages, context, logLevel, writeStreamType, errorStack, merged);
  }
}
