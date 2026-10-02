import { HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, type AccountType, type Permission } from '@havenhub/shared';
import type { Request } from 'express';

import { AppException, Errors } from '../../../common/errors/app.exception';
import {
  ACCOUNT_TYPES,
  PERMISSIONS_KEY,
  REQUIRE_VERIFIED_EMAIL,
} from '../decorators/auth.decorators';

/**
 * Global guard enforcing `@AccountTypes`, `@RequirePermissions` and
 * `@RequireVerifiedEmail`. The backend is the only authority: the web app
 * may hide navigation, but every check happens here.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const accountTypes = this.reflector.getAllAndOverride<AccountType[] | undefined>(
      ACCOUNT_TYPES,
      targets,
    );
    const permissions = this.reflector.getAllAndMerge<Permission[]>(PERMISSIONS_KEY, targets);
    const requireVerified = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_VERIFIED_EMAIL,
      targets,
    );

    if (!accountTypes?.length && !permissions.length && !requireVerified) return true;

    const auth = context.switchToHttp().getRequest<Request>().auth;
    if (!auth) throw Errors.unauthenticated();

    if (accountTypes?.length && !accountTypes.includes(auth.user.accountType)) {
      throw Errors.forbidden();
    }
    if (permissions.some((permission) => !auth.permissions.has(permission))) {
      throw Errors.insufficientPermissions();
    }
    // Sensitive actions always need a verified email, even when
    // REQUIRE_EMAIL_VERIFICATION=false relaxes the rule for signing in.
    if (requireVerified && !auth.user.emailVerifiedAt) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.EMAIL_NOT_VERIFIED,
        'Please verify your email address first.',
      );
    }
    return true;
  }
}
