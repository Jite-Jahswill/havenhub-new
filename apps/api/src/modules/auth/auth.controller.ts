import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  AUTH_COOKIES,
  AUTH_MODE_HEADER,
  AuthMode,
  changePasswordSchema,
  emailOnlySchema,
  loginSchema,
  refreshTokenSchema,
  registerAgentSchema,
  registerCustomerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@havenhub/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import { requestMeta } from '../../common/http/request-meta';
import { ok } from '../../common/http/response';
import { validate } from '../../common/pipes/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { ClientType } from '../../generated/prisma/client';
import { AuthCookiesService } from './auth-cookies.service';
import { AuthService } from './auth.service';
import type { AuthContext } from './auth.types';
import { CurrentAuth, OptionalAuth, Public, SkipCsrf } from './decorators/auth.decorators';
import { MaintenanceExempt } from '../platform/maintenance';
import type { IssuedSession } from './session.service';
import { SessionService } from './session.service';

const MINUTE = 60;
const HOUR = 60 * MINUTE;

const REGISTRATION_MESSAGE =
  'Thanks! If this email can be used, we have sent a link to verify your account.';
const GENERIC_EMAIL_MESSAGE = 'If an account exists for this email, we have sent instructions.';

/**
 * Authentication for both client types:
 *  - Web (default): tokens are set as HttpOnly cookies and never appear in
 *    the response body.
 *  - Token clients (Flutter, integrations): send `X-Auth-Mode: token` to
 *    receive tokens in the body, then use `Authorization: Bearer`.
 */
// Sign-in and account flows stay available during maintenance.
@MaintenanceExempt()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly cookies: AuthCookiesService,
  ) {}

  @Public()
  @SkipCsrf()
  @Post('register/customer')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ name: 'register:ip', limit: 10, windowSeconds: HOUR, by: 'ip' })
  async registerCustomer(
    @Body(validate(registerCustomerSchema)) body: z.output<typeof registerCustomerSchema>,
  ) {
    await this.auth.registerCustomer(body);
    return ok({ message: REGISTRATION_MESSAGE });
  }

  @Public()
  @SkipCsrf()
  @Post('register/agent')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ name: 'register:ip', limit: 10, windowSeconds: HOUR, by: 'ip' })
  async registerAgent(
    @Body(validate(registerAgentSchema)) body: z.output<typeof registerAgentSchema>,
  ) {
    await this.auth.registerAgent(body);
    return ok({ message: REGISTRATION_MESSAGE });
  }

  @Public()
  @SkipCsrf()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit(
    { name: 'login:ip+email', limit: 10, windowSeconds: 15 * MINUTE, by: 'ip+email' },
    { name: 'login:ip', limit: 50, windowSeconds: 15 * MINUTE, by: 'ip' },
  )
  async login(
    @Body(validate(loginSchema)) body: z.output<typeof loginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const mode = authMode(req);
    const { issued, user } = await this.auth.login(body, clientTypeFor(mode), requestMeta(req));
    return ok({ user, ...this.deliver(mode, issued, res) });
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'refresh:ip', limit: 120, windowSeconds: 15 * MINUTE, by: 'ip' })
  async refresh(
    @Body(validate(refreshTokenSchema)) body: z.output<typeof refreshTokenSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const mode = authMode(req);
    const token =
      mode === AuthMode.TOKEN ? body.refreshToken : this.cookies.read(req, AUTH_COOKIES.REFRESH);
    if (!token) throw Errors.unauthenticated();
    try {
      const { issued, user } = await this.auth.refresh(
        token,
        clientTypeFor(mode),
        requestMeta(req),
      );
      return ok({ user, ...this.deliver(mode, issued, res) });
    } catch (error) {
      if (mode === AuthMode.COOKIE) this.cookies.clear(res);
      throw error;
    }
  }

  /** Revokes the current session. Works even if the access token has expired. */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Body(validate(refreshTokenSchema)) body: z.output<typeof refreshTokenSchema>,
    @OptionalAuth() auth: AuthContext | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (auth) {
      await this.sessions.revoke(auth.sessionId, 'logout');
    } else {
      await this.auth.logout(
        body.refreshToken ??
          this.cookies.read(req, AUTH_COOKIES.REFRESH) ??
          this.cookies.read(req, AUTH_COOKIES.ACCESS),
      );
    }
    this.cookies.clear(res);
    return ok({ loggedOut: true });
  }

  /** Signs out every device, including this one. */
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    const revoked = await this.sessions.revokeAllForUser(auth.user.id, 'logout_all');
    this.cookies.clear(res);
    return ok({ revoked });
  }

  @Get('me')
  async me(@CurrentAuth() auth: AuthContext) {
    return ok(await this.auth.authUser(auth.user.id));
  }

  @Public()
  @SkipCsrf()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'verify-email:ip', limit: 30, windowSeconds: 15 * MINUTE, by: 'ip' })
  async verifyEmail(@Body(validate(verifyEmailSchema)) body: z.output<typeof verifyEmailSchema>) {
    await this.auth.verifyEmail(body.token);
    return ok({ verified: true });
  }

  @Public()
  @SkipCsrf()
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(
    { name: 'resend:email', limit: 3, windowSeconds: HOUR, by: 'email' },
    { name: 'resend:ip', limit: 20, windowSeconds: HOUR, by: 'ip' },
  )
  async resendVerification(
    @Body(validate(emailOnlySchema)) body: z.output<typeof emailOnlySchema>,
  ) {
    await this.auth.resendVerification(body.email);
    return ok({ message: GENERIC_EMAIL_MESSAGE });
  }

  @Public()
  @SkipCsrf()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(
    { name: 'forgot:email', limit: 3, windowSeconds: HOUR, by: 'email' },
    { name: 'forgot:ip', limit: 20, windowSeconds: HOUR, by: 'ip' },
  )
  async forgotPassword(@Body(validate(emailOnlySchema)) body: z.output<typeof emailOnlySchema>) {
    await this.auth.forgotPassword(body.email);
    return ok({ message: GENERIC_EMAIL_MESSAGE });
  }

  @Public()
  @SkipCsrf()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'reset:ip', limit: 20, windowSeconds: 15 * MINUTE, by: 'ip' })
  async resetPassword(
    @Body(validate(resetPasswordSchema)) body: z.output<typeof resetPasswordSchema>,
    @Req() req: Request,
  ) {
    await this.auth.resetPassword(body, requestMeta(req));
    return ok({ reset: true });
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'change-password:user', limit: 10, windowSeconds: 15 * MINUTE, by: 'user' })
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body(validate(changePasswordSchema)) body: z.output<typeof changePasswordSchema>,
    @Req() req: Request,
  ) {
    await this.auth.changePassword(auth.user.id, auth.sessionId, body, requestMeta(req));
    return ok({ changed: true });
  }

  @Get('sessions')
  async listSessions(@CurrentAuth() auth: AuthContext) {
    return ok(await this.sessions.listActive(auth.user.id, auth.sessionId));
  }

  @Delete('sessions/:id')
  async revokeSession(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.sessions.revokeOwn(auth.user.id, id);
    return ok({ revoked: true });
  }

  /** Cookie mode: set cookies, return nothing secret. Token mode: return tokens. */
  private deliver(mode: AuthMode, issued: IssuedSession, res: Response) {
    if (mode === AuthMode.TOKEN) return { tokens: issued.tokens };
    this.cookies.set(res, issued.session.id, issued.tokens);
    return {};
  }
}

function authMode(req: Request): AuthMode {
  return req.get(AUTH_MODE_HEADER)?.toLowerCase() === AuthMode.TOKEN
    ? AuthMode.TOKEN
    : AuthMode.COOKIE;
}

const clientTypeFor = (mode: AuthMode): ClientType =>
  mode === AuthMode.TOKEN ? ClientType.TOKEN : ClientType.WEB;
