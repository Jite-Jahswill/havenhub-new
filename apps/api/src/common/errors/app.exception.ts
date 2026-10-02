import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@havenhub/shared';

/**
 * The single exception type for expected, client-facing failures. The
 * exception filter turns it into the shared `ApiError` envelope.
 */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const Errors = {
  unauthenticated: (message = 'Please sign in to continue.') =>
    new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHENTICATED, message),
  forbidden: (message = 'You do not have access to this resource.') =>
    new AppException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, message),
  insufficientPermissions: () =>
    new AppException(
      HttpStatus.FORBIDDEN,
      ErrorCode.INSUFFICIENT_PERMISSIONS,
      'You do not have permission to perform this action.',
    ),
  notFound: (resource = 'Resource') =>
    new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, `${resource} not found.`),
  conflict: (message: string) => new AppException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, message),
  badRequest: (message: string, code: ErrorCode = ErrorCode.BAD_REQUEST) =>
    new AppException(HttpStatus.BAD_REQUEST, code, message),
  invalidToken: (message = 'This link is invalid or has expired.') =>
    new AppException(HttpStatus.BAD_REQUEST, ErrorCode.INVALID_TOKEN, message),
};
