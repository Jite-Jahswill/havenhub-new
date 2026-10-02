import { createHmac } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { AUTH_COOKIES, type AuthTokens } from '@havenhub/shared';
import type { CookieOptions, Request, Response } from 'express';

import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { parseSessionToken, safeEqual } from '../../infrastructure/crypto/tokens';

/**
 * Web-client cookie handling.
 *
 *  - `hh_at` / `hh_rt`: HttpOnly session tokens — never readable by JavaScript.
 *  - `hh_csrf`: readable CSRF token, an HMAC of the session id. The web app
 *    echoes it in the `X-CSRF-Token` header on state-changing requests.
 *    Because it is derived from the session, a cookie planted by an attacker
 *    (e.g. from a sibling subdomain) cannot match a victim's session.
 *
 * All cookies are SameSite=Lax and Secure in production. They are scoped to
 * Path=/ because the web app's server needs them to render signed-in pages.
 */
@Injectable()
export class AuthCookiesService {
  private readonly csrfKey: Buffer;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.csrfKey = Buffer.from(env.AUTH_SECRET, 'base64');
  }

  set(res: Response, sessionId: string, tokens: AuthTokens): void {
    const refreshExpires = new Date(tokens.refreshTokenExpiresAt);
    res.cookie(AUTH_COOKIES.ACCESS, tokens.accessToken, {
      ...this.base(),
      httpOnly: true,
      expires: new Date(tokens.accessTokenExpiresAt),
    });
    res.cookie(AUTH_COOKIES.REFRESH, tokens.refreshToken, {
      ...this.base(),
      httpOnly: true,
      expires: refreshExpires,
    });
    res.cookie(AUTH_COOKIES.CSRF, this.csrfTokenFor(sessionId), {
      ...this.base(),
      httpOnly: false,
      expires: refreshExpires,
    });
  }

  clear(res: Response): void {
    for (const name of Object.values(AUTH_COOKIES)) {
      res.clearCookie(name, this.base());
    }
  }

  read(req: Request, name: string): string | undefined {
    const value = (req.cookies as Record<string, unknown> | undefined)?.[name];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  hasSessionCookie(req: Request): boolean {
    return Boolean(this.read(req, AUTH_COOKIES.ACCESS) ?? this.read(req, AUTH_COOKIES.REFRESH));
  }

  /** The session id carried by the access or refresh cookie (not yet verified). */
  cookieSessionId(req: Request): string | undefined {
    const token = this.read(req, AUTH_COOKIES.ACCESS) ?? this.read(req, AUTH_COOKIES.REFRESH);
    return token ? parseSessionToken(token)?.sessionId : undefined;
  }

  csrfTokenFor(sessionId: string): string {
    return createHmac('sha256', this.csrfKey).update(`csrf:${sessionId}`).digest('base64url');
  }

  verifyCsrf(sessionId: string, presented: string | undefined): boolean {
    return Boolean(presented) && safeEqual(this.csrfTokenFor(sessionId), presented!);
  }

  private base(): CookieOptions {
    return {
      path: '/',
      sameSite: 'lax',
      secure: this.env.cookieSecure,
      ...(this.env.COOKIE_DOMAIN ? { domain: this.env.COOKIE_DOMAIN } : {}),
    };
  }
}
