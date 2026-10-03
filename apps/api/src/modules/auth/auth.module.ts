import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { AuthCookiesService } from './auth-cookies.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthenticationGuard } from './guards/authentication.guard';
import { AuthorizationGuard } from './guards/authorization.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { MaintenanceGuard } from '../platform/maintenance';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { VerificationTokenService } from './verification-token.service';

/**
 * Global guards run in this order for every route:
 *   1. RateLimitGuard      — per-route limits (before any expensive work)
 *   2. AuthenticationGuard — resolves the caller; secure by default
 *   3. CsrfGuard           — cookie-authenticated mutations only
 *   4. AuthorizationGuard  — account types, permissions, verified email
 *   5. MaintenanceGuard    — 503 for non-admins while maintenance mode is on
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    PasswordService,
    VerificationTokenService,
    AuthCookiesService,
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
    { provide: APP_GUARD, useClass: MaintenanceGuard },
  ],
  exports: [AuthService, SessionService, PasswordService],
})
export class AuthModule {}
