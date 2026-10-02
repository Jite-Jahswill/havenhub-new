/** Cookie and header names shared by the API and the web app. */
export const AUTH_COOKIES = {
  ACCESS: 'hh_at',
  REFRESH: 'hh_rt',
  /** Readable by JavaScript on purpose: the double-submit CSRF token. */
  CSRF: 'hh_csrf',
} as const;

export const CSRF_HEADER = 'x-csrf-token';

/**
 * Clients that cannot use cookies (the Flutter app, server-to-server) send
 * `X-Auth-Mode: token` on login/refresh to receive tokens in the response
 * body and then authenticate with `Authorization: Bearer <accessToken>`.
 */
export const AUTH_MODE_HEADER = 'x-auth-mode';
export const AuthMode = { COOKIE: 'cookie', TOKEN: 'token' } as const;
export type AuthMode = (typeof AuthMode)[keyof typeof AuthMode];
