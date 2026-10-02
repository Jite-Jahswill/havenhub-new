import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ErrorCode, type ApiError } from '@havenhub/shared';
import type { Response } from 'express';

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

/**
 * Converts every error into the shared `ApiError` envelope. Unexpected
 * errors are logged in full but only a generic message reaches the client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

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

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    const payload: ApiError = {
      success: false,
      message: 'Something went wrong. Please try again.',
      code: ErrorCode.INTERNAL_ERROR,
    };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(payload);
  }
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
