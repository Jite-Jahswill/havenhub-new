import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ErrorCode, type ApiError } from '@havenhub/shared';
import type { Request, Response } from 'express';

import { describeError, framesOf } from '../logging/describe-error';
import { pathOf } from '../logging/request-context';
import { classifyDatabaseError, databaseErrorCode } from './database-errors';

const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.INVALID_FILE,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ErrorCode.VALIDATION_ERROR,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
};

const DATABASE_RESPONSES = {
  conflict: {
    status: HttpStatus.CONFLICT,
    code: ErrorCode.CONFLICT,
    message: 'This conflicts with an existing record. Please refresh and try again.',
  },
  not_found: {
    status: HttpStatus.NOT_FOUND,
    code: ErrorCode.NOT_FOUND,
    message: 'Not found.',
  },
  retryable: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    code: ErrorCode.SERVICE_UNAVAILABLE,
    message: 'The request clashed with another change. Please try again.',
  },
} as const;

/**
 * Converts every error into the shared `ApiError` envelope. Expected
 * concurrency errors from the database (duplicates, missing rows, deadlocks)
 * get meaningful statuses with generic messages. Unexpected errors are logged
 * with the request id, method and path (never the query string or body) and
 * the error's class, code and stack frames — but only a generic message
 * reaches the client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request | undefined>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload: ApiError = {
        success: false,
        message: typeof body === 'string' ? body : extractMessage(body, exception.message),
        code: extractField(body, 'code') ?? STATUS_CODES[status] ?? 'HTTP_ERROR',
      };
      const details =
        typeof body === 'object' ? (body as { details?: unknown }).details : undefined;
      if (details !== undefined) payload.details = details;
      response.status(status).json(payload);
      return;
    }

    const kind = classifyDatabaseError(exception);
    if (kind) {
      const mapped = DATABASE_RESPONSES[kind];
      // Code only: messages can quote SQL, values or constraint contents.
      this.logger.warn(`Database ${kind}`, {
        event: 'http.database_error',
        kind,
        code: databaseErrorCode(exception) ?? 'unknown',
        ...context(request),
      });
      response
        .status(mapped.status)
        .json({ success: false, message: mapped.message, code: mapped.code } satisfies ApiError);
      return;
    }

    this.logger.error('Unhandled error', {
      event: 'http.unhandled_error',
      ...context(request),
      ...describeError(exception),
      stack: framesOf(exception),
    });
    const payload: ApiError = {
      success: false,
      message: 'Something went wrong. Please try again.',
      code: ErrorCode.INTERNAL_ERROR,
    };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(payload);
  }
}

/** Where the error happened: request id, method and path without the query string. */
function context(request: Request | undefined) {
  if (!request?.method) return {};
  return { requestId: request.requestId, method: request.method, path: pathOf(request) };
}

function extractMessage(body: object, fallback: string): string {
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join(', ');
  return fallback;
}

function extractField(body: unknown, key: string): string | undefined {
  if (typeof body === 'object' && body !== null) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}
