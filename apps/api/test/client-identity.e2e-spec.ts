import { Reflector } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { parseClientIp } from '../src/common/http/client-ip';
import { RATE_LIMIT, type RateLimitRule } from '../src/common/rate-limit/rate-limit.decorator';
import { CustomerBookingsController } from '../src/modules/bookings/bookings.controller';
import { ChatController } from '../src/modules/chat/chat.controller';
import { CustomerPaymentsController } from '../src/modules/payments/payments.controller';
import { AdminSettingsController } from '../src/modules/platform/platform.controller';
import { createAdmin, createTestContext, PASSWORD, type TestContext } from './helpers/test-app';

const SECRET = 'internal-secret-for-tests-0123456789abcdef';
const INTERNAL = 'x-havenhub-internal';
const CLIENT_IP = 'x-havenhub-client-ip';

let ctx: TestContext;

beforeAll(async () => {
  // Production-like: rate limits on, one trusted proxy hop (the Railway edge).
  ctx = await createTestContext({
    RATE_LIMIT_ENABLED: true,
    INTERNAL_API_SECRET: SECRET,
    trustProxy: 1,
  });
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

type Headers = Record<string, string>;
const asVisitor = (ip: string): Headers => ({ [INTERNAL]: SECRET, [CLIENT_IP]: ip });

/** Signs in and returns the IP the API recorded on the new session. */
async function sessionIp(headers: Headers = {}, context: TestContext = ctx) {
  const admin = await createAdmin(context, []);
  await context
    .http()
    .post('/api/v1/auth/login')
    .set('X-Auth-Mode', 'token')
    .set(headers)
    .send({ email: admin.email, password: PASSWORD })
    .expect(200);
  const session = await context.prisma.session.findFirstOrThrow({ where: { userId: admin.id } });
  return session.ipAddress;
}

async function login(email: string, headers: Headers = {}) {
  const res = await ctx
    .http()
    .post('/api/v1/auth/login')
    .set('X-Auth-Mode', 'token')
    .set(headers)
    .send({ email, password: PASSWORD })
    .expect(200);
  return { Authorization: `Bearer ${res.body.data.tokens.accessToken as string}` };
}

describe('canonical client IP (A1)', () => {
  it('uses the connection address for direct requests', async () => {
    expect(await sessionIp()).toMatch(/127\.0\.0\.1$/);
  });

  it('takes only the hop appended by the trusted edge, never a client-chosen X-Forwarded-For', async () => {
    // The edge appends the real peer last; anything to its left came from the client.
    expect(await sessionIp({ 'X-Forwarded-For': '1.2.3.4, 198.51.100.7' })).toBe('198.51.100.7');
    expect(await sessionIp({ 'X-Real-IP': '1.2.3.4' })).toMatch(/127\.0\.0\.1$/);
  });

  it('honours the visitor IP from the web server only with the valid internal secret', async () => {
    expect(await sessionIp(asVisitor('203.0.114.20'))).toBe('203.0.114.20');
    expect(await sessionIp(asVisitor('2A00:1450:4009:81F::200E'))).toBe('2a00:1450:4009:81f::200e');

    expect(await sessionIp({ [INTERNAL]: 'wrong-secret', [CLIENT_IP]: '203.0.114.21' })).toMatch(
      /127\.0\.0\.1$/,
    );
    expect(await sessionIp({ [INTERNAL]: `${SECRET}x`, [CLIENT_IP]: '203.0.114.21' })).toMatch(
      /127\.0\.0\.1$/,
    );
    expect(await sessionIp({ [CLIENT_IP]: '203.0.114.21' })).toMatch(/127\.0\.0\.1$/);
    // A valid secret without a visitor IP falls back to the connection address.
    expect(await sessionIp({ [INTERNAL]: SECRET })).toMatch(/127\.0\.0\.1$/);
  });

  it('rejects malformed visitor IPs even with the valid secret', async () => {
    for (const bad of [
      'not-an-ip',
      '203.0.114.20, 1.2.3.4',
      '203.0.114.20:443',
      'fe80::1%eth0',
      '999.1.1.1',
      'a'.repeat(60),
    ]) {
      expect(await sessionIp(asVisitor(bad)), bad).toMatch(/127\.0\.0\.1$/);
    }
    expect(parseClientIp(['203.0.114.20'])).toBeNull();
  });

  it('ignores the header entirely when the API has no internal secret', async () => {
    const open = await createTestContext({ INTERNAL_API_SECRET: undefined, trustProxy: 1 });
    try {
      expect(await sessionIp(asVisitor('203.0.114.22'), open)).toMatch(/127\.0\.0\.1$/);
    } finally {
      await open.close();
    }
  });

  it('records the canonical IP in the audit log', async () => {
    const admin = await createAdmin(ctx, ['super_admin']);
    await login(admin.email, asVisitor('203.0.114.30'));
    const entry = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'auth.admin_login', actorId: admin.id },
    });
    expect(entry.ipAddress).toBe('203.0.114.30');
  });
});

describe('IP-based limits use the canonical IP (A1 + A3)', () => {
  // register:ip allows 10 per hour; validation runs after the limiter, so `{}` is enough.
  const register = (headers: Headers = {}) =>
    ctx.http().post('/api/v1/auth/register/customer').set(headers).send({});
  const burn = async (headers: Headers, times: number) => {
    const statuses: number[] = [];
    for (let i = 0; i < times; i++) statuses.push((await register(headers)).status);
    return statuses;
  };

  it('gives each visitor behind the web server its own bucket', async () => {
    expect(await burn(asVisitor('203.0.114.40'), 10)).toEqual(Array(10).fill(422));
    expect((await register(asVisitor('203.0.114.40'))).status).toBe(429);
    expect((await register(asVisitor('203.0.114.41'))).status).toBe(422);
    // The web server's own address is a different bucket again.
    expect((await register()).status).toBe(422);
  });

  it('cannot be bypassed with forged identity headers', async () => {
    expect(await burn({}, 10)).toEqual(Array(10).fill(422));
    const attempts: Headers[] = [
      { [INTERNAL]: 'wrong-secret', [CLIENT_IP]: '203.0.114.50' },
      { [CLIENT_IP]: '203.0.114.51' },
      { 'X-Real-IP': '203.0.114.52' },
    ];
    for (const forged of attempts) {
      const res = await register(forged);
      expect(res.status, JSON.stringify(forged)).toBe(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    }
    // Only the genuine web server can speak for another visitor.
    expect((await register(asVisitor('203.0.114.53'))).status).toBe(422);
  });
});

describe('per-user limits after authentication (A3)', () => {
  // smtp-test:user allows 5 per 10 minutes. With no SMTP configured each call
  // answers 409, so the limiter is the only thing that changes the status.
  const smtpTest = (auth: Headers, ip: string) =>
    ctx.http().post('/api/v1/admin/settings/smtp/test').set(auth).set(asVisitor(ip));

  it('gives two users on one IP independent quotas', async () => {
    const a = await createAdmin(ctx, ['super_admin']);
    const b = await createAdmin(ctx, ['super_admin']);
    const authA = await login(a.email, asVisitor('203.0.114.60'));
    const authB = await login(b.email, asVisitor('203.0.114.60'));
    for (let i = 0; i < 5; i++) await smtpTest(authA, '203.0.114.60').expect(409);
    await smtpTest(authA, '203.0.114.60').expect(429);
    for (let i = 0; i < 5; i++) await smtpTest(authB, '203.0.114.60').expect(409);
    await smtpTest(authB, '203.0.114.60').expect(429);
  });

  it('shares one quota for a user across different IPs', async () => {
    const a = await createAdmin(ctx, ['super_admin']);
    const auth = await login(a.email);
    for (let i = 0; i < 5; i++) await smtpTest(auth, `203.0.114.${70 + i}`).expect(409);
    const res = await smtpTest(auth, '203.0.114.99');
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('runs after authentication: anonymous calls are refused without using any quota', async () => {
    for (let i = 0; i < 8; i++) {
      await ctx
        .http()
        .post('/api/v1/admin/settings/smtp/test')
        .set(asVisitor('203.0.114.80'))
        .expect(401);
    }
    const a = await createAdmin(ctx, ['super_admin']);
    const auth = await login(a.email, asVisitor('203.0.114.80'));
    await smtpTest(auth, '203.0.114.80').expect(409);
  });

  it('covers chat, payments, bookings and the SMTP test with user-keyed rules only', () => {
    const reflector = new Reflector();
    const rules = (target: object, method: string) =>
      reflector.get<RateLimitRule[]>(
        RATE_LIMIT,
        (target as Record<string, (...args: unknown[]) => unknown>)[method]!,
      );
    const cases: [object, string, string][] = [
      [ChatController.prototype, 'send', 'message-send:user'],
      [ChatController.prototype, 'upload', 'chat-upload:user'],
      [CustomerPaymentsController.prototype, 'initiate', 'payment-init:user'],
      [CustomerPaymentsController.prototype, 'verify', 'payment-verify:user'],
      [CustomerBookingsController.prototype, 'create', 'booking-create:user'],
      [AdminSettingsController.prototype, 'testSmtp', 'smtp-test:user'],
    ];
    for (const [target, method, name] of cases) {
      expect(rules(target, method), method).toEqual([
        expect.objectContaining({ name, by: 'user' }),
      ]);
    }
  });
});
