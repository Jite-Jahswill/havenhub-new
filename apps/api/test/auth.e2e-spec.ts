import { AUTH_COOKIES, AUTH_MODE_HEADER } from '@havenhub/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  PASSWORD,
  WEB_ORIGIN,
  bearer,
  createTestContext,
  expectNoSecrets,
  loginCookie,
  loginToken,
  parseSetCookies,
  registerAgent,
  registerCustomer,
  tokenFromMail,
  uniqueEmail,
  type TestContext,
} from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

describe('registration', () => {
  it('creates a customer and sends a verification email', async () => {
    const email = uniqueEmail();
    const res = await ctx
      .http()
      .post('/api/v1/auth/register/customer')
      .send({
        fullName: 'Ada Obi',
        email: email.toUpperCase(),
        password: PASSWORD,
        phone: '0803 123 4567',
      })
      .expect(202);
    expectNoSecrets(res.body, [PASSWORD]);

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.accountType).toBe('CUSTOMER');
    expect(user.phone).toBe('+2348031234567');
    expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(user.emailVerifiedAt).toBeNull();
    expect(ctx.mail.lastTo(email)?.subject).toMatch(/verify/i);
  });

  it('creates an agent with a pending agent profile', async () => {
    const { email } = await registerAgent(ctx, { verify: false });
    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { email },
      include: { agentProfile: true },
    });
    expect(user.accountType).toBe('AGENT');
    expect(user.agentProfile?.verificationStatus).toBe('PENDING');
    expect(user.agentProfile?.serviceTypes).toEqual(['LANDLORD']);
  });

  it('never creates an admin, even if the client asks for one', async () => {
    const email = uniqueEmail();
    await ctx
      .http()
      .post('/api/v1/auth/register/customer')
      .send({
        fullName: 'Mallory',
        email,
        password: PASSWORD,
        accountType: 'ADMIN',
        roles: ['super_admin'],
      })
      .expect(202);
    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { email },
      include: { roles: true },
    });
    expect(user.accountType).toBe('CUSTOMER');
    expect(user.roles).toHaveLength(0);
  });

  it('does not reveal whether an email is already registered', async () => {
    const { email } = await registerCustomer(ctx);
    ctx.mail.clear();
    const res = await ctx
      .http()
      .post('/api/v1/auth/register/customer')
      .send({ fullName: 'Someone Else', email, password: 'another-long-password' })
      .expect(202);
    expect(res.body.data.message).toMatch(/if this email can be used/i);
    expect(ctx.mail.lastTo(email)?.subject).toMatch(/already have/i);
    expect(await ctx.prisma.user.count({ where: { email } })).toBe(1);
  });

  it('validates input with field-level errors', async () => {
    const res = await ctx
      .http()
      .post('/api/v1/auth/register/customer')
      .send({ fullName: 'A', email: 'not-an-email', password: 'short' })
      .expect(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    const paths = res.body.details.issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['fullName', 'email', 'password']));
  });
});

describe('email verification', () => {
  it('is required before login', async () => {
    const creds = await registerCustomer(ctx, { verify: false });
    const res = await ctx.http().post('/api/v1/auth/login').send(creds).expect(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('verifies with a single-use token', async () => {
    const creds = await registerCustomer(ctx, { verify: false });
    const token = tokenFromMail(ctx, creds.email, '/verify-email');
    await ctx.http().post('/api/v1/auth/verify-email').send({ token }).expect(200);
    const again = await ctx.http().post('/api/v1/auth/verify-email').send({ token }).expect(400);
    expect(again.body.code).toBe('INVALID_TOKEN');
    await loginToken(ctx, creds);
  });

  it('resending invalidates the previous link', async () => {
    const creds = await registerCustomer(ctx, { verify: false });
    const first = tokenFromMail(ctx, creds.email, '/verify-email');
    await ctx
      .http()
      .post('/api/v1/auth/resend-verification')
      .send({ email: creds.email })
      .expect(202);
    const second = tokenFromMail(ctx, creds.email, '/verify-email');
    expect(second).not.toBe(first);
    await ctx.http().post('/api/v1/auth/verify-email').send({ token: first }).expect(400);
    await ctx.http().post('/api/v1/auth/verify-email').send({ token: second }).expect(200);
  });

  it('can be disabled by configuration', async () => {
    const relaxed = await createTestContext({ REQUIRE_EMAIL_VERIFICATION: false });
    try {
      const creds = await registerCustomer(relaxed, { verify: false });
      await relaxed
        .http()
        .post('/api/v1/auth/login')
        .set(AUTH_MODE_HEADER, 'token')
        .send(creds)
        .expect(200);
    } finally {
      await relaxed.close();
    }
  });
});

describe('login', () => {
  it('rejects wrong passwords and unknown emails identically', async () => {
    const creds = await registerCustomer(ctx);
    const wrong = await ctx
      .http()
      .post('/api/v1/auth/login')
      .send({ ...creds, password: 'wrong-password-123' });
    const unknown = await ctx
      .http()
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail(), password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('token mode returns tokens and never the password hash', async () => {
    const creds = await registerCustomer(ctx);
    const { user, tokens } = await loginToken(ctx, creds);
    expect(tokens.accessToken).toMatch(/^[0-9a-f-]{36}\./);
    expectNoSecrets(user, [PASSWORD]);

    const me = await ctx.http().get('/api/v1/auth/me').set(bearer(tokens.accessToken)).expect(200);
    expect(me.body.data.email).toBe(creds.email);
    expectNoSecrets(me.body, [PASSWORD]);
  });

  it('cookie mode sets HttpOnly session cookies and returns no tokens', async () => {
    const creds = await registerCustomer(ctx);
    const { res, cookies } = await loginCookie(ctx, creds);
    expect(res.body.data.tokens).toBeUndefined();
    expectNoSecrets(res.body, [PASSWORD, cookies[AUTH_COOKIES.ACCESS]!.value]);

    expect(cookies[AUTH_COOKIES.ACCESS]!.attributes).toEqual(
      expect.arrayContaining(['HttpOnly', 'SameSite=Lax', 'Path=/']),
    );
    expect(cookies[AUTH_COOKIES.REFRESH]!.attributes).toContain('HttpOnly');
    expect(cookies[AUTH_COOKIES.CSRF]!.attributes).not.toContain('HttpOnly');
  });

  it('marks cookies Secure when configured for production', async () => {
    const secure = await createTestContext({ cookieSecure: true });
    try {
      const creds = await registerCustomer(secure);
      const { cookies } = await loginCookie(secure, creds);
      expect(cookies[AUTH_COOKIES.ACCESS]!.attributes).toContain('Secure');
      expect(cookies[AUTH_COOKIES.REFRESH]!.attributes).toContain('Secure');
    } finally {
      await secure.close();
    }
  });
});

describe('protected endpoints', () => {
  it.each([
    ['get', '/api/v1/auth/me'],
    ['get', '/api/v1/users/me'],
    ['patch', '/api/v1/users/me'],
    ['get', '/api/v1/auth/sessions'],
    ['get', '/api/v1/agents/me'],
    ['get', '/api/v1/admin/users'],
    ['get', '/api/v1/admin/overview'],
  ] as const)('%s %s requires authentication', async (method, path) => {
    const res = await ctx.http()[method](path).expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects forged or malformed bearer tokens', async () => {
    const creds = await registerCustomer(ctx);
    const { tokens } = await loginToken(ctx, creds);
    const [id] = tokens.accessToken.split('.');
    for (const token of [
      `${id}.forged-secret-forged-secret-forged-secret-xx`,
      'garbage',
      tokens.refreshToken,
    ]) {
      await ctx.http().get('/api/v1/auth/me').set(bearer(token)).expect(401);
    }
  });
});

describe('refresh tokens', () => {
  it('rotate on every use', async () => {
    const { tokens } = await loginToken(ctx, await registerCustomer(ctx));
    const res = await ctx
      .http()
      .post('/api/v1/auth/refresh')
      .set(AUTH_MODE_HEADER, 'token')
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);
    const next = res.body.data.tokens;
    expect(next.refreshToken).not.toBe(tokens.refreshToken);
    expect(next.accessToken).not.toBe(tokens.accessToken);
    await ctx.http().get('/api/v1/auth/me').set(bearer(next.accessToken)).expect(200);
    // The previous access token is replaced.
    await ctx.http().get('/api/v1/auth/me').set(bearer(tokens.accessToken)).expect(401);
  });

  it('revoke the whole session when an old refresh token is reused', async () => {
    const { tokens } = await loginToken(ctx, await registerCustomer(ctx));
    const rotated = await ctx
      .http()
      .post('/api/v1/auth/refresh')
      .set(AUTH_MODE_HEADER, 'token')
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);
    // Simulate the grace window having passed.
    await ctx.prisma.session.updateMany({
      data: { refreshRotatedAt: new Date(Date.now() - 60_000) },
    });

    await ctx
      .http()
      .post('/api/v1/auth/refresh')
      .set(AUTH_MODE_HEADER, 'token')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);
    // The legitimate holder's new tokens are now revoked too.
    await ctx
      .http()
      .get('/api/v1/auth/me')
      .set(bearer(rotated.body.data.tokens.accessToken))
      .expect(401);
    const session = await ctx.prisma.session.findFirstOrThrow();
    expect(session.revokedReason).toBe('refresh_token_reuse');
  });

  it('web refresh uses the cookie and requires the CSRF token', async () => {
    const creds = await registerCustomer(ctx);
    const { cookieHeader, csrf } = await loginCookie(ctx, creds);
    await ctx
      .http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader)
      .set('Origin', WEB_ORIGIN)
      .expect(403);
    const res = await ctx
      .http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader)
      .set(csrf)
      .expect(200);
    expect(parseSetCookies(res.headers['set-cookie'])[AUTH_COOKIES.ACCESS]).toBeDefined();
  });
});

describe('logout', () => {
  it('invalidates a bearer session immediately', async () => {
    const { tokens } = await loginToken(ctx, await registerCustomer(ctx));
    await ctx.http().post('/api/v1/auth/logout').set(bearer(tokens.accessToken)).expect(200);
    await ctx.http().get('/api/v1/auth/me').set(bearer(tokens.accessToken)).expect(401);
    await ctx
      .http()
      .post('/api/v1/auth/refresh')
      .set(AUTH_MODE_HEADER, 'token')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);
  });

  it('invalidates a cookie session and clears cookies', async () => {
    const { cookieHeader, csrf } = await loginCookie(ctx, await registerCustomer(ctx));
    const res = await ctx
      .http()
      .post('/api/v1/auth/logout')
      .set('Cookie', cookieHeader)
      .set(csrf)
      .expect(200);
    const cleared = parseSetCookies(res.headers['set-cookie']);
    expect(cleared[AUTH_COOKIES.ACCESS]!.value).toBe('');
    await ctx.http().get('/api/v1/auth/me').set('Cookie', cookieHeader).expect(401);
  });

  it('only affects the current device', async () => {
    const creds = await registerCustomer(ctx);
    const phone = await loginToken(ctx, creds);
    const laptop = await loginToken(ctx, creds);
    await ctx.http().post('/api/v1/auth/logout').set(bearer(phone.tokens.accessToken)).expect(200);
    await ctx.http().get('/api/v1/auth/me').set(bearer(laptop.tokens.accessToken)).expect(200);
  });

  it('logout-all signs out every device', async () => {
    const creds = await registerCustomer(ctx);
    const a = await loginToken(ctx, creds);
    const b = await loginToken(ctx, creds);
    await ctx.http().post('/api/v1/auth/logout-all').set(bearer(a.tokens.accessToken)).expect(200);
    await ctx.http().get('/api/v1/auth/me').set(bearer(a.tokens.accessToken)).expect(401);
    await ctx.http().get('/api/v1/auth/me').set(bearer(b.tokens.accessToken)).expect(401);
  });
});

describe('sessions', () => {
  it('lists own sessions and can revoke another device', async () => {
    const creds = await registerCustomer(ctx);
    const a = await loginToken(ctx, creds);
    const b = await loginToken(ctx, creds);
    const list = await ctx
      .http()
      .get('/api/v1/auth/sessions')
      .set(bearer(a.tokens.accessToken))
      .expect(200);
    expect(list.body.data).toHaveLength(2);
    const other = list.body.data.find((s: { current: boolean }) => !s.current);
    await ctx
      .http()
      .delete(`/api/v1/auth/sessions/${other.id}`)
      .set(bearer(a.tokens.accessToken))
      .expect(200);
    await ctx.http().get('/api/v1/auth/me').set(bearer(b.tokens.accessToken)).expect(401);
  });
});

describe('password reset', () => {
  it('responds identically for unknown emails', async () => {
    const known = await registerCustomer(ctx);
    const a = await ctx
      .http()
      .post('/api/v1/auth/forgot-password')
      .send({ email: known.email })
      .expect(202);
    const b = await ctx
      .http()
      .post('/api/v1/auth/forgot-password')
      .send({ email: uniqueEmail() })
      .expect(202);
    expect(a.body).toEqual(b.body);
  });

  it('sets a new password, revokes all sessions and is single-use', async () => {
    const creds = await registerCustomer(ctx);
    const { tokens } = await loginToken(ctx, creds);
    await ctx.http().post('/api/v1/auth/forgot-password').send({ email: creds.email }).expect(202);
    const token = tokenFromMail(ctx, creds.email, '/reset-password');

    await ctx
      .http()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'brand-new-password-2' })
      .expect(200);
    await ctx.http().get('/api/v1/auth/me').set(bearer(tokens.accessToken)).expect(401);
    await ctx.http().post('/api/v1/auth/login').send(creds).expect(401);
    await loginToken(ctx, { email: creds.email, password: 'brand-new-password-2' });
    await ctx
      .http()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'another-password-3' })
      .expect(400);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'auth.password_reset' } })).toBe(1);
  });

  it('rejects expired tokens', async () => {
    const creds = await registerCustomer(ctx);
    await ctx.http().post('/api/v1/auth/forgot-password').send({ email: creds.email }).expect(202);
    const token = tokenFromMail(ctx, creds.email, '/reset-password');
    await ctx.prisma.verificationToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await ctx
      .http()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'brand-new-password-2' })
      .expect(400);
  });
});

describe('change password', () => {
  it('requires the current password and signs out other devices', async () => {
    const creds = await registerCustomer(ctx);
    const current = await loginToken(ctx, creds);
    const other = await loginToken(ctx, creds);

    await ctx
      .http()
      .post('/api/v1/auth/change-password')
      .set(bearer(current.tokens.accessToken))
      .send({ currentPassword: 'not-my-password', newPassword: 'brand-new-password-2' })
      .expect(422);

    await ctx
      .http()
      .post('/api/v1/auth/change-password')
      .set(bearer(current.tokens.accessToken))
      .send({ currentPassword: PASSWORD, newPassword: 'brand-new-password-2' })
      .expect(200);
    await ctx.http().get('/api/v1/auth/me').set(bearer(current.tokens.accessToken)).expect(200);
    await ctx.http().get('/api/v1/auth/me').set(bearer(other.tokens.accessToken)).expect(401);
  });
});

describe('CSRF protection', () => {
  it('rejects cookie-authenticated mutations without a valid token', async () => {
    const { cookieHeader, csrf } = await loginCookie(ctx, await registerCustomer(ctx));
    const patch = () =>
      ctx
        .http()
        .patch('/api/v1/users/me')
        .set('Cookie', cookieHeader)
        .send({ fullName: 'New Name' });

    expect((await patch().set('Origin', WEB_ORIGIN).expect(403)).body.code).toBe(
      'CSRF_TOKEN_INVALID',
    );
    await patch()
      .set({ ...csrf, 'x-csrf-token': 'forged' })
      .expect(403);
    await patch()
      .set({ ...csrf, Origin: 'https://evil.example' })
      .expect(403);
    await patch().set(csrf).expect(200);
  });

  it('does not accept a CSRF token from another session', async () => {
    const a = await loginCookie(ctx, await registerCustomer(ctx));
    const b = await loginCookie(ctx, await registerCustomer(ctx));
    await ctx
      .http()
      .patch('/api/v1/users/me')
      .set('Cookie', a.cookieHeader)
      .set(b.csrf)
      .send({ fullName: 'New Name' })
      .expect(403);
  });

  it('does not apply to bearer-token clients', async () => {
    const { tokens } = await loginToken(ctx, await registerCustomer(ctx));
    await ctx
      .http()
      .patch('/api/v1/users/me')
      .set(bearer(tokens.accessToken))
      .send({ fullName: 'New Name' })
      .expect(200);
  });
});

describe('rate limiting', () => {
  it('throttles repeated login attempts', async () => {
    const limited = await createTestContext({ RATE_LIMIT_ENABLED: true });
    try {
      await limited.reset();
      const attempt = () =>
        limited
          .http()
          .post('/api/v1/auth/login')
          .send({ email: 'victim@example.com', password: 'guess-guess-1' });
      for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401);
      const blocked = await attempt().expect(429);
      expect(blocked.body.code).toBe('RATE_LIMITED');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      await limited.close();
    }
  });
});
