import { HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_COOKIES, ErrorCode, UserStatus } from '@havenhub/shared';
import type { Request } from 'express';

import { AppException, Errors } from '../../../common/errors/app.exception';
import { RbacService } from '../../rbac/rbac.service';
import { AuthCookiesService } from '../auth-cookies.service';
import type { AuthContext, CredentialSource } from '../auth.types';
import { IS_PUBLIC } from '../decorators/auth.decorators';
import { SessionService } from '../session.service';

/**
 * Global guard. Resolves the caller from `Authorization: Bearer <token>`
 * (mobile/API clients) or the HttpOnly `hh_at` cookie (web), then loads the
 * user's current status, roles and permissions from the database. Role or
 * account-type claims sent by a client are never consulted.
 */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly rbac: RbacService,
    private readonly cookies: AuthCookiesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<Request>();
    const credential = this.extract(req);

    if (!credential) {
      if (isPublic) return true;
      throw Errors.unauthenticated();
    }

    const session = await this.sessions.authenticate(credential.token);
    if (!session) {
      if (isPublic) return true;
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.SESSION_EXPIRED,
        'Your session has expired. Please sign in again.',
      );
    }

    const { user } = session;
    if (user.status !== UserStatus.ACTIVE) {
      await this.sessions.revoke(session.id, 'account_status_changed');
      throw accountStatusError(user.status);
    }

    const access = await this.rbac.getAccess(user.id, user.accountType);
    const auth: AuthContext = {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        accountType: user.accountType,
        status: user.status,
        emailVerifiedAt: user.emailVerifiedAt,
      },
      sessionId: session.id,
      source: credential.source,
      roleKeys: access.roleKeys,
      permissions: access.permissions,
    };
    req.auth = auth;
    return true;
  }

  private extract(req: Request): { token: string; source: CredentialSource } | undefined {
    const header = req.get('authorization');
    if (header) {
      const [scheme, token] = header.split(' ');
      if (scheme?.toLowerCase() === 'bearer' && token) return { token, source: 'bearer' };
      return undefined;
    }
    const cookie = this.cookies.read(req, AUTH_COOKIES.ACCESS);
    return cookie ? { token: cookie, source: 'cookie' } : undefined;
  }
}

export function accountStatusError(status: string): AppException {
  return status === UserStatus.BLOCKED
    ? new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCOUNT_BLOCKED,
        'This account has been blocked. Please contact support.',
      )
    : new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCOUNT_SUSPENDED,
        'This account is suspended. Please contact support.',
      );
}
