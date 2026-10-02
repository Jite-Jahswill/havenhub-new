import {
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CSRF_HEADER, ErrorCode } from '@havenhub/shared';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app.exception';
import { ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { AuthCookiesService } from '../auth-cookies.service';
import { SKIP_CSRF } from '../decorators/auth.decorators';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-authenticated, state-changing requests.
 * Bearer-token requests are exempt: browsers never attach them automatically.
 *
 *  1. Origin check — if the browser sends an Origin, it must be an allowed web origin.
 *  2. Token check — `X-CSRF-Token` must equal the HMAC of the cookie's session id.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowedOrigins: Set<string>;

  constructor(
    private readonly reflector: Reflector,
    private readonly cookies: AuthCookiesService,
    @Inject(ENV) env: Env,
  ) {
    this.allowedOrigins = new Set([...env.CORS_ORIGINS, new URL(env.WEB_APP_URL).origin]);
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (req.get('authorization')) return true;

    const origin = req.get('origin');
    if (origin && origin !== 'null' && !this.allowedOrigins.has(origin)) throw csrfError();
    if (origin === 'null') throw csrfError();

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip || !this.cookies.hasSessionCookie(req)) return true;

    const sessionId = req.auth?.sessionId ?? this.cookies.cookieSessionId(req);
    if (!sessionId || !this.cookies.verifyCsrf(sessionId, req.get(CSRF_HEADER))) {
      throw csrfError();
    }
    return true;
  }
}

const csrfError = () =>
  new AppException(
    HttpStatus.FORBIDDEN,
    ErrorCode.CSRF_TOKEN_INVALID,
    'Your request could not be verified. Please refresh the page and try again.',
  );
