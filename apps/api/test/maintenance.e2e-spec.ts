import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminAuth, customer, paystackWebhook } from './helpers/booking-helpers';
import {
  createAgent,
  createTestContext,
  PASSWORD,
  registerCustomer,
  type TestContext,
} from './helpers/test-app';

let ctx: TestContext;
/** A second API instance on the same database and Redis. */
let other: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
  other = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(async () => {
  await other.close();
  await ctx.close();
});

const MAINTENANCE = '/api/v1/admin/settings/maintenance';

async function setMaintenance(body: Record<string, unknown>) {
  const admin = await adminAuth(ctx, ['super_admin']);
  const res = await ctx.http().patch(MAINTENANCE).set(admin.auth).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return admin;
}

function expectMaintenance(res: {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}) {
  expect(res.status).toBe(503);
  expect(res.headers['retry-after']).toBe('300');
  expect(res.body).toMatchObject({ success: false, code: 'MAINTENANCE_MODE' });
}

describe('maintenance mode', () => {
  it('is off by default', async () => {
    await ctx.http().get('/api/v1/properties').expect(200);
    const status = await ctx.http().get('/api/v1/platform/status').expect(200);
    expect(status.body.data.maintenance).toMatchObject({ enabled: false, retryAfterSeconds: 300 });
    expect(status.body.data.site.name).toBe('HavenHub');
  });

  it('blocks public and customer/agent requests with 503 + Retry-After; admins pass', async () => {
    const buyer = await customer(ctx);
    const agent = await createAgent(ctx);
    const admin = await setMaintenance({
      enabled: true,
      message: 'Upgrading our systems.',
      returnText: 'Back by 3pm WAT',
    });

    const guest = await ctx.http().get('/api/v1/properties');
    expectMaintenance(guest);
    expect(guest.body.message).toBe('Upgrading our systems.');
    expectMaintenance(await ctx.http().get('/api/v1/bookings').set(buyer.auth));
    expectMaintenance(await ctx.http().get('/api/v1/agents/me/properties').set(agent.auth));
    expectMaintenance(await ctx.http().get('/api/v1/favorites').set(buyer.auth));

    // Nothing the client sends can switch it off.
    expectMaintenance(
      await ctx
        .http()
        .get('/api/v1/properties')
        .set('X-Maintenance', 'off')
        .query({ maintenance: 'false' }),
    );

    // Administrators keep the whole admin API.
    await ctx.http().get('/api/v1/admin/users').set(admin.auth).expect(200);
    await ctx.http().get(MAINTENANCE).set(admin.auth).expect(200);
    await ctx.http().get('/api/v1/properties').set(admin.auth).expect(200);

    // The audit trail records who switched it on and the message.
    const entry = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'platform.maintenance.enabled' },
    });
    expect(entry.actorId).toBe(admin.id);
    expect(entry.before).toMatchObject({ enabled: false });
    expect(entry.after).toMatchObject({ enabled: true, message: 'Upgrading our systems.' });

    const status = await ctx.http().get('/api/v1/platform/status').expect(200);
    expect(status.body.data.maintenance).toEqual({
      enabled: true,
      message: 'Upgrading our systems.',
      returnText: 'Back by 3pm WAT',
      retryAfterSeconds: 300,
    });
  });

  it('keeps sign-in, health checks, webhooks, branding and media available', async () => {
    const creds = await registerCustomer(ctx);
    await setMaintenance({ enabled: true });

    const login = await ctx
      .http()
      .post('/api/v1/auth/login')
      .set('X-Auth-Mode', 'token')
      .send({ email: creds.email, password: PASSWORD });
    expect(login.status).toBe(200);
    await ctx
      .http()
      .get('/api/v1/auth/me')
      .set({ Authorization: `Bearer ${login.body.data.tokens.accessToken}` })
      .expect(200);
    await ctx.http().post('/api/v1/auth/forgot-password').send({ email: creds.email }).expect(202);

    await ctx.http().get('/api/health/live').expect(200);
    expect((await ctx.http().get('/api/health')).status).not.toBe(503);

    // A signed Paystack webhook is still processed (unknown reference: acknowledged, ignored).
    const hook = await paystackWebhook(ctx, {
      event: 'charge.success',
      data: { reference: 'HH-unknown-reference' },
    });
    expect(hook.status).not.toBe(503);
    expect(hook.status).toBeLessThan(500);

    await ctx.http().get('/api/v1/site').expect(200);
    expect((await ctx.http().get('/api/media/cms/site/none.webp')).status).toBe(404);
  });

  it('switches every API instance immediately, on and off', async () => {
    // The other instance has read (and cached) the "off" state.
    await other.http().get('/api/v1/properties').expect(200);
    await setMaintenance({ enabled: true });
    expectMaintenance(await other.http().get('/api/v1/properties'));

    const admin = await adminAuth(ctx, ['super_admin']);
    await ctx.http().patch(MAINTENANCE).set(admin.auth).send({ enabled: false }).expect(200);
    await other.http().get('/api/v1/properties').expect(200);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'platform.maintenance.disabled' } }),
    ).toBe(1);
  });

  it('only settings.maintenance may read or change it; input is validated', async () => {
    for (const role of ['admin', 'content_manager', 'support_admin', 'finance_admin']) {
      const auth = (await adminAuth(ctx, [role])).auth;
      await ctx.http().get(MAINTENANCE).set(auth).expect(403);
      await ctx.http().patch(MAINTENANCE).set(auth).send({ enabled: true }).expect(403);
    }
    const buyer = await customer(ctx);
    await ctx.http().patch(MAINTENANCE).set(buyer.auth).send({ enabled: true }).expect(403);
    await ctx.http().patch(MAINTENANCE).send({ enabled: true }).expect(401);

    const auth = (await adminAuth(ctx, ['super_admin'])).auth;
    for (const bad of [{}, { enabled: 'yes' }, { message: 'x'.repeat(501) }, { other: 1 }]) {
      await ctx.http().patch(MAINTENANCE).set(auth).send(bad).expect(422);
    }
    await ctx.http().get('/api/v1/properties').expect(200);
  });
});
