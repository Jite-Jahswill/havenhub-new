import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AccountType, Permission } from '@havenhub/shared';
import type { Request } from 'express';

import { Errors } from '../../../common/errors/app.exception';
import type { AuthContext } from '../auth.types';

export const IS_PUBLIC = 'auth:public';
export const ACCOUNT_TYPES = 'auth:accountTypes';
export const PERMISSIONS_KEY = 'auth:permissions';
export const REQUIRE_VERIFIED_EMAIL = 'auth:verifiedEmail';
export const SKIP_CSRF = 'auth:skipCsrf';

/**
 * Every route requires authentication unless marked `@Public()`. Public
 * routes still resolve the caller when credentials are present.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restrict a route or controller to specific account types. */
export const AccountTypes = (...types: AccountType[]) => SetMetadata(ACCOUNT_TYPES, types);

/** Require ALL listed RBAC permissions (admin accounts only). */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const RequireVerifiedEmail = () => SetMetadata(REQUIRE_VERIFIED_EMAIL, true);

/**
 * For endpoints that do not act on ambient credentials (login, registration,
 * token-based email flows). Origin checks still apply.
 */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

/** Injects the authenticated caller. Throws if the route is public and unauthenticated. */
export const CurrentAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthContext => {
    const auth = ctx.switchToHttp().getRequest<Request>().auth;
    if (!auth) throw Errors.unauthenticated();
    return auth;
  },
);

/** Injects the caller if authenticated, otherwise `undefined`. */
export const OptionalAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthContext | undefined =>
    ctx.switchToHttp().getRequest<Request>().auth,
);
