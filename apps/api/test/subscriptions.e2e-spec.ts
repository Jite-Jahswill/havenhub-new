import type {
  AdminSubscriptionPlanView,
  CurrentSubscriptionView,
  PlanEntitlements,
  SubscriptionCheckoutView,
} from '@havenhub/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TestPaymentProvider } from '../src/modules/finance/providers/test-payment.provider';
import { SubscriptionMaintenanceService } from '../src/modules/subscriptions/subscription-maintenance.service';
import { adminAuth, customer, paystackWebhook } from './helpers/booking-helpers';
import {
  completeProperty,
  createAgent,
  createDraft,
  createPublished,
  testImage,
  uploadImage,
  createTestContext,
  type Agent,
  type TestContext,
} from './helpers/test-app';

let ctx: TestContext;
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

const PROPERTIES = '/api/v1/agents/me/properties';
const SUB = '/api/v1/agents/me/subscription';
const PLANS = '/api/v1/admin/subscription-plans';

const limits = (overrides: Partial<PlanEntitlements> = {}): PlanEntitlements => ({
  PROPERTY_COUNT: 3,
  IMAGES_PER_PROPERTY: 20,
  VIDEOS_PER_PROPERTY: 2,
  FEATURED_PROPERTY_COUNT: 1,
  STORAGE_MB: 500,
  EVENT_COUNT: 1,
  TOUR_COUNT: 0,
  CLEANING_SERVICE_COUNT: 0,
  HOTEL_COUNT: 0,
  ...overrides,
});

async function financeAdmin() {
  return adminAuth(ctx, ['finance_admin']);
}

async function createPlan(
  body: Record<string, unknown> = {},
  auth?: Record<string, string>,
): Promise<AdminSubscriptionPlanView> {
  const res = await ctx
    .http()
    .post(PLANS)
    .set(auth ?? (await financeAdmin()).auth)
    .send({
      name: 'Starter',
      priceKobo: 500_000,
      billingInterval: 'MONTHLY',
      rank: 1,
      features: ['3 properties'],
      entitlements: limits(),
      ...body,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as AdminSubscriptionPlanView;
}

const current = async (agent: Agent) =>
  (await ctx.http().get(SUB).set(agent.auth).expect(200)).body.data as CurrentSubscriptionView;

async function checkout(agent: Agent, planId: string) {
  const res = await ctx.http().post(`${SUB}/checkout`).set(agent.auth).send({ planId });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as SubscriptionCheckoutView;
}

/** Agent pays on the simulated checkout; the server then verifies with the provider. */
async function subscribe(agent: Agent, planId: string, outcome: 'success' | 'failed' = 'success') {
  const { reference } = await checkout(agent, planId);
  const res = await ctx
    .http()
    .post(`${SUB}/test-checkout/${reference}`)
    .set(agent.auth)
    .send({ outcome })
    .expect(200);
  return { reference, result: res.body.data };
}

const terms = (agent: Agent) =>
  ctx.prisma.agentSubscription.findMany({
    where: { agentProfileId: agent.agentProfileId },
    orderBy: { createdAt: 'asc' },
  });

const audits = (action: string) => ctx.prisma.auditLog.count({ where: { action } });

/**
 * Simulates the active term running out: it now ended a minute ago, and any
 * queued term (which starts when it ends) starts then too.
 */
async function endActiveTerm(agent: Agent) {
  const term = await ctx.prisma.agentSubscription.findFirstOrThrow({
    where: { agentProfileId: agent.agentProfileId, status: 'ACTIVE' },
  });
  const ended = new Date(Date.now() - 60_000);
  const shift = term.currentPeriodEnd.getTime() - ended.getTime();
  await ctx.prisma.agentSubscription.update({
    where: { id: term.id },
    data: {
      currentPeriodStart: new Date(term.currentPeriodStart.getTime() - shift),
      currentPeriodEnd: ended,
    },
  });
  for (const queued of await ctx.prisma.agentSubscription.findMany({
    where: { agentProfileId: agent.agentProfileId, status: 'PENDING' },
  })) {
    await ctx.prisma.agentSubscription.update({
      where: { id: queued.id },
      data: {
        currentPeriodStart: new Date(queued.currentPeriodStart.getTime() - shift),
        currentPeriodEnd: new Date(queued.currentPeriodEnd.getTime() - shift),
      },
    });
  }
  return term;
}

describe('plans', () => {
  it('a free default plan exists and is public; it allows exactly one property', async () => {
    const plans = (await ctx.http().get('/api/v1/subscriptions/plans').expect(200)).body.data;
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      isDefault: true,
      priceKobo: 0,
      billingInterval: null,
      entitlements: { PROPERTY_COUNT: 1 },
    });

    const agent = await createAgent(ctx);
    expect((await current(agent)).plan.isDefault).toBe(true);
    await createDraft(ctx, agent);
    const res = await ctx
      .http()
      .post(PROPERTIES)
      .set(agent.auth)
      .send(completeProperty())
      .expect(403);
    expect(res.body).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      details: { entitlement: 'PROPERTY_COUNT', limit: 1, used: 1, planName: 'Free' },
    });
    expect(res.body.message).toMatch(/property limit/);
  });

  it('admins create, update, deactivate and archive plans — every change audited', async () => {
    const finance = await financeAdmin();
    const plan = await createPlan({}, finance.auth);
    expect(plan).toMatchObject({
      slug: 'starter',
      status: 'ACTIVE',
      priceKobo: 500_000,
      entitlements: limits(),
      activeSubscribers: 0,
      canDelete: true,
    });
    expect(await audits('subscription_plan.created')).toBe(1);

    const updated = (
      await ctx
        .http()
        .patch(`${PLANS}/${plan.id}`)
        .set(finance.auth)
        .send({ entitlements: limits({ PROPERTY_COUNT: 5 }), priceKobo: 600_000 })
        .expect(200)
    ).body.data;
    expect(updated).toMatchObject({ priceKobo: 600_000, entitlements: { PROPERTY_COUNT: 5 } });
    expect(await audits('subscription_plan.limits_changed')).toBe(1);

    await ctx
      .http()
      .post(`${PLANS}/${plan.id}/status`)
      .set(finance.auth)
      .send({ status: 'INACTIVE' })
      .expect(200);
    const offered = (await ctx.http().get('/api/v1/subscriptions/plans').expect(200)).body.data;
    expect(offered.map((p: { id: string }) => p.id)).not.toContain(plan.id);
    const agent = await createAgent(ctx);
    const refused = await ctx
      .http()
      .post(`${SUB}/checkout`)
      .set(agent.auth)
      .send({ planId: plan.id })
      .expect(422);
    expect(refused.body.code).toBe('PLAN_NOT_AVAILABLE');

    await ctx
      .http()
      .post(`${PLANS}/${plan.id}/status`)
      .set(finance.auth)
      .send({ status: 'ARCHIVED' })
      .expect(200);
    await ctx
      .http()
      .post(`${PLANS}/${plan.id}/status`)
      .set(finance.auth)
      .send({ status: 'ACTIVE' })
      .expect(409);
    expect(await audits('subscription_plan.archived')).toBe(1);
  });

  it('rejects invalid plans', async () => {
    const finance = await financeAdmin();
    const send = (body: Record<string, unknown>) =>
      ctx
        .http()
        .post(PLANS)
        .set(finance.auth)
        .send({
          name: 'Bad',
          priceKobo: 500_000,
          billingInterval: 'MONTHLY',
          rank: 1,
          entitlements: limits(),
          ...body,
        });
    expect((await send({ entitlements: limits({ PROPERTY_COUNT: -1 }) })).status).toBe(422);
    const { STORAGE_MB: _omitted, ...partial } = limits();
    expect((await send({ entitlements: partial })).status).toBe(422);
    expect((await send({ entitlements: limits({ IMAGES_PER_PROPERTY: 2.5 }) })).status).toBe(422);
    expect((await send({ priceKobo: 0 })).status).toBe(422);
    expect((await send({ billingInterval: 'WEEKLY' })).status).toBe(422);
    expect((await send({ slug: 'Not A Slug!' })).status).toBe(422);
    await createPlan({ slug: 'taken' }, finance.auth);
    expect((await send({ slug: 'taken' })).status).toBe(409);
  });

  it('the free default plan keeps a zero price, stays offered and cannot be deleted', async () => {
    const finance = await financeAdmin();
    const free = await ctx.prisma.subscriptionPlan.findFirstOrThrow({ where: { isDefault: true } });
    await ctx
      .http()
      .patch(`${PLANS}/${free.id}`)
      .set(finance.auth)
      .send({ priceKobo: 1000 })
      .expect(400);
    await ctx
      .http()
      .post(`${PLANS}/${free.id}/status`)
      .set(finance.auth)
      .send({ status: 'INACTIVE' })
      .expect(409);
    await ctx.http().delete(`${PLANS}/${free.id}`).set(finance.auth).expect(409);
    // Its limits are configurable, though: the property limit is data, not code.
    await ctx
      .http()
      .patch(`${PLANS}/${free.id}`)
      .set(finance.auth)
      .send({ entitlements: limits({ PROPERTY_COUNT: 2, FEATURED_PROPERTY_COUNT: 0 }) })
      .expect(200);
    const agent = await createAgent(ctx);
    await createDraft(ctx, agent);
    await createDraft(ctx, agent);
    await ctx.http().post(PROPERTIES).set(agent.auth).send(completeProperty()).expect(403);
  });

  it('only never-used plans can be deleted', async () => {
    const finance = await financeAdmin();
    const unused = await createPlan({ name: 'Unused' }, finance.auth);
    await ctx.http().delete(`${PLANS}/${unused.id}`).set(finance.auth).expect(200);
    expect(await audits('subscription_plan.deleted')).toBe(1);

    const used = await createPlan({ name: 'Used' }, finance.auth);
    await subscribe(await createAgent(ctx), used.id);
    const res = await ctx.http().delete(`${PLANS}/${used.id}`).set(finance.auth).expect(409);
    expect(res.body.message).toMatch(/Archive it instead/);
  });
});

describe('subscribing', () => {
  it('a verified payment activates the plan and raises the limits', async () => {
    const plan = await createPlan();
    const agent = await createAgent(ctx);
    await createDraft(ctx, agent);

    const quote = (
      await ctx.http().get(`${SUB}/quote?planId=${plan.id}`).set(agent.auth).expect(200)
    ).body.data;
    expect(quote).toMatchObject({
      changeType: 'NEW',
      amountKobo: 500_000,
      startsImmediately: true,
    });

    const pending = await checkout(agent, plan.id);
    expect(pending.reference).toMatch(/^HHS-[0-9a-f]{24}$/);
    expect(pending.authorizationUrl).toContain('/payments/test-checkout?reference=');
    // Nothing is granted before the provider confirms payment.
    expect((await current(agent)).plan.isDefault).toBe(true);
    expect(await terms(agent)).toHaveLength(0);

    await ctx
      .http()
      .post(`${SUB}/test-checkout/${pending.reference}`)
      .set(agent.auth)
      .send({ outcome: 'success' })
      .expect(200);
    const now = await current(agent);
    expect(now.plan.id).toBe(plan.id);
    expect(now.subscription).toMatchObject({
      status: 'ACTIVE',
      changeType: 'NEW',
      priceKobo: 500_000,
    });
    expect(now.usage.find((u) => u.key === 'PROPERTY_COUNT')).toMatchObject({ used: 1, limit: 3 });

    await createDraft(ctx, agent);
    await createDraft(ctx, agent);
    await ctx.http().post(PROPERTIES).set(agent.auth).send(completeProperty()).expect(403);

    const payments = (await ctx.http().get(`${SUB}/payments`).set(agent.auth).expect(200)).body
      .data;
    expect(payments).toEqual([
      expect.objectContaining({ status: 'SUCCESS', amountKobo: 500_000, planName: 'Starter' }),
    ]);
    expect(await audits('subscription.activated')).toBe(1);
    expect(await audits('subscription_payment.succeeded')).toBe(1);
    expect(ctx.mail.sent.some((m) => m.subject.includes('Starter plan is active'))).toBe(true);
  });

  it('the amount is set by the server: client-sent prices and limits are ignored', async () => {
    const plan = await createPlan();
    const agent = await createAgent(ctx);
    const res = await ctx
      .http()
      .post(`${SUB}/checkout`)
      .set(agent.auth)
      .send({ planId: plan.id, amountKobo: 1, priceKobo: 1, entitlements: { PROPERTY_COUNT: 999 } })
      .expect(201);
    expect(res.body.data.amountKobo).toBe(500_000);
    const payment = await ctx.prisma.subscriptionPayment.findUniqueOrThrow({
      where: { reference: res.body.data.reference },
    });
    expect(payment.amountKobo).toBe(500_000n);
  });

  it('a declined payment grants nothing and tells the agent', async () => {
    const plan = await createPlan();
    const agent = await createAgent(ctx);
    const { reference, result } = await subscribe(agent, plan.id, 'failed');
    expect(result).toMatchObject({ paymentStatus: 'FAILED', subscription: null });
    expect(await terms(agent)).toHaveLength(0);
    expect((await current(agent)).plan.isDefault).toBe(true);
    expect(
      (await ctx.prisma.subscriptionPayment.findUniqueOrThrow({ where: { reference } })).status,
    ).toBe('FAILED');
    expect(ctx.mail.sent.some((m) => m.subject.includes('did not go through'))).toBe(true);
  });

  it('a payment the provider reports differently is never accepted', async () => {
    const plan = await createPlan();
    const agent = await createAgent(ctx);
    const { reference } = await checkout(agent, plan.id);
    await ctx.app.get(TestPaymentProvider).simulate(reference, 'success', { amountKobo: '100' });
    const res = await ctx
      .http()
      .post(`${SUB}/payments/${reference}/verify`)
      .set(agent.auth)
      .expect(200);
    expect(res.body.data.paymentStatus).toBe('FAILED');
    expect(await terms(agent)).toHaveLength(0);
    expect(await audits('subscription_payment.verification_mismatch')).toBe(1);
  });

  it('repeated, concurrent and webhook verification settle a payment exactly once', async () => {
    const plan = await createPlan();
    const agent = await createAgent(ctx);
    const { reference } = await checkout(agent, plan.id);
    await ctx.app.get(TestPaymentProvider).simulate(reference, 'success');

    const verify = (app: TestContext) =>
      app.http().post(`${SUB}/payments/${reference}/verify`).set(agent.auth);
    const results = await Promise.all([
      verify(ctx),
      verify(other),
      verify(ctx),
      paystackWebhook(ctx, { event: 'charge.success', data: { reference } }),
      paystackWebhook(other, { event: 'charge.success', data: { reference } }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    await paystackWebhook(ctx, { event: 'charge.success', data: { reference } }).expect(200);

    expect(await terms(agent)).toHaveLength(1);
    expect(await audits('subscription.activated')).toBe(1);
    expect(await audits('subscription_payment.succeeded')).toBe(1);
  });

  it('agents can only see and verify their own payments', async () => {
    const plan = await createPlan();
    const owner = await createAgent(ctx);
    const intruder = await createAgent(ctx);
    const { reference } = await checkout(owner, plan.id);
    await ctx.http().post(`${SUB}/payments/${reference}/verify`).set(intruder.auth).expect(404);
    await ctx.http().get(`${SUB}/test-checkout/${reference}`).set(intruder.auth).expect(404);
    expect(
      (await ctx.http().get(`${SUB}/payments`).set(intruder.auth).expect(200)).body.data,
    ).toEqual([]);
    // Customers have no subscription endpoints at all.
    const c = await customer(ctx);
    await ctx.http().get(SUB).set(c.auth).expect(403);
  });
});

describe('changing plans', () => {
  it('upgrade: starts now, ends the old term (no proration), history is kept', async () => {
    const starter = await createPlan();
    const pro = await createPlan({ name: 'Professional', rank: 2, priceKobo: 1_500_000 });
    const agent = await createAgent(ctx);
    await subscribe(agent, starter.id);

    const quote = (
      await ctx.http().get(`${SUB}/quote?planId=${pro.id}`).set(agent.auth).expect(200)
    ).body.data;
    expect(quote).toMatchObject({ changeType: 'UPGRADE', startsImmediately: true });
    expect(quote.notes.join(' ')).toMatch(/not refunded or credited/);

    await subscribe(agent, pro.id);
    const [first, second] = await terms(agent);
    expect(first).toMatchObject({ status: 'CANCELLED', endReason: 'Upgraded to Professional' });
    expect(second).toMatchObject({ status: 'ACTIVE', changeType: 'UPGRADE' });
    expect((await current(agent)).plan.id).toBe(pro.id);
    const history = (await ctx.http().get(`${SUB}/history`).set(agent.auth).expect(200)).body.data;
    expect(history.map((h: { plan: { name: string } }) => h.plan.name)).toEqual([
      'Professional',
      'Starter',
    ]);
  });

  it('renewal: queued after the current term; only one change can be queued', async () => {
    const starter = await createPlan();
    const pro = await createPlan({ name: 'Professional', rank: 2, priceKobo: 1_500_000 });
    const agent = await createAgent(ctx);
    await subscribe(agent, starter.id);
    const active = (await terms(agent))[0]!;

    await subscribe(agent, starter.id);
    const renewal = (await terms(agent))[1]!;
    expect(renewal).toMatchObject({ status: 'PENDING', changeType: 'RENEWAL' });
    expect(renewal.currentPeriodStart.getTime()).toBe(active.currentPeriodEnd.getTime());
    expect((await current(agent)).scheduled?.id).toBe(renewal.id);

    const refused = await ctx
      .http()
      .post(`${SUB}/checkout`)
      .set(agent.auth)
      .send({ planId: pro.id })
      .expect(409);
    expect(refused.body.code).toBe('SUBSCRIPTION_CHANGE_SCHEDULED');
  });

  it('downgrade: explained up front, starts at period end, and never deletes anything', async () => {
    const starter = await createPlan();
    const pro = await createPlan({
      name: 'Professional',
      rank: 2,
      priceKobo: 1_500_000,
      entitlements: limits({ PROPERTY_COUNT: 10 }),
    });
    const agent = await createAgent(ctx);
    await subscribe(agent, pro.id);
    for (let i = 0; i < 4; i++) await createDraft(ctx, agent);

    const quote = (
      await ctx.http().get(`${SUB}/quote?planId=${starter.id}`).set(agent.auth).expect(200)
    ).body.data;
    expect(quote).toMatchObject({ changeType: 'DOWNGRADE', startsImmediately: false });
    expect(quote.overLimit).toEqual([
      { key: 'PROPERTY_COUNT', label: 'Properties', used: 4, limit: 3 },
    ]);

    await subscribe(agent, starter.id);
    expect((await current(agent)).plan.id).toBe(pro.id); // unchanged until the term ends

    await endActiveTerm(agent);
    await ctx.app.get(SubscriptionMaintenanceService).reconcileDue();
    const after = await current(agent);
    expect(after.plan.id).toBe(starter.id);
    expect(after.overLimit).toEqual(['PROPERTY_COUNT']);
    // All four properties are still there; only new ones are blocked.
    expect(
      await ctx.prisma.property.count({ where: { agentProfileId: agent.agentProfileId } }),
    ).toBe(4);
    await ctx.http().post(PROPERTIES).set(agent.auth).send(completeProperty()).expect(403);
  });
});

describe('cancellation and expiry', () => {
  it('cancel at period end keeps the plan, and can be undone', async () => {
    const plan = await createPlan();
    const agent = await createAgent(ctx);
    await subscribe(agent, plan.id);
    const cancelled = (
      await ctx
        .http()
        .post(`${SUB}/cancel`)
        .set(agent.auth)
        .send({ mode: 'END_OF_PERIOD' })
        .expect(200)
    ).body.data;
    expect(cancelled.subscription).toMatchObject({ status: 'ACTIVE', cancelAtPeriodEnd: true });
    expect(cancelled.plan.id).toBe(plan.id);

    const resumed = (await ctx.http().post(`${SUB}/resume`).set(agent.auth).expect(200)).body.data;
    expect(resumed.subscription.cancelAtPeriodEnd).toBe(false);

    await ctx
      .http()
      .post(`${SUB}/cancel`)
      .set(agent.auth)
      .send({ mode: 'END_OF_PERIOD' })
      .expect(200);
    await endActiveTerm(agent);
    await ctx.app.get(SubscriptionMaintenanceService).reconcileDue();
    const [term] = await terms(agent);
    expect(term).toMatchObject({
      status: 'CANCELLED',
      endReason: 'Cancelled at the end of the paid term',
    });
  });

  it('cancel immediately returns the agent to the free plan; data is kept', async () => {
    const plan = await createPlan();
    const agent = await createAgent(ctx);
    await subscribe(agent, plan.id);
    await createDraft(ctx, agent);
    await createDraft(ctx, agent);
    const res = (
      await ctx.http().post(`${SUB}/cancel`).set(agent.auth).send({ mode: 'IMMEDIATE' }).expect(200)
    ).body.data;
    expect(res.plan.isDefault).toBe(true);
    expect(res.subscription).toBeNull();
    expect(res.overLimit).toEqual(['PROPERTY_COUNT']);
    expect(
      await ctx.prisma.property.count({ where: { agentProfileId: agent.agentProfileId } }),
    ).toBe(2);
    expect((await terms(agent))[0]).toMatchObject({ status: 'CANCELLED' });
    // Nothing to cancel on the free plan.
    await ctx.http().post(`${SUB}/cancel`).set(agent.auth).send({ mode: 'IMMEDIATE' }).expect(409);
  });

  it('expiry: limits drop the moment the term ends, the sweep records it once and notifies', async () => {
    const plan = await createPlan();
    const agent = await createAgent(ctx);
    await subscribe(agent, plan.id);
    await createDraft(ctx, agent);
    await endActiveTerm(agent);

    // Entitlements follow the term dates even before any sweep runs.
    expect((await current(agent)).plan.isDefault).toBe(true);
    await ctx.http().post(PROPERTIES).set(agent.auth).send(completeProperty()).expect(403);

    const [a, b] = await Promise.all([
      ctx.app.get(SubscriptionMaintenanceService).runOnce(),
      other.app.get(SubscriptionMaintenanceService).runOnce(),
    ]);
    expect((a.reconciled ?? 0) + (b.reconciled ?? 0)).toBe(1);
    expect((await terms(agent))[0]).toMatchObject({ status: 'EXPIRED' });
    expect(await audits('subscription.expired')).toBe(1);
    expect(ctx.mail.sent.some((m) => m.subject.includes('plan has ended'))).toBe(true);
    expect(
      await ctx.prisma.property.count({ where: { agentProfileId: agent.agentProfileId } }),
    ).toBe(1);
  });

  it('sends one expiry reminder a few days before the end', async () => {
    const plan = await createPlan();
    const agent = await createAgent(ctx);
    await subscribe(agent, plan.id);
    const term = (await terms(agent))[0]!;
    await ctx.prisma.agentSubscription.update({
      where: { id: term.id },
      data: { currentPeriodEnd: new Date(Date.now() + 2 * 24 * 3600 * 1000) },
    });
    const sweep = ctx.app.get(SubscriptionMaintenanceService);
    const sent = await Promise.all([
      sweep.sendReminders(),
      other.app.get(SubscriptionMaintenanceService).sendReminders(),
    ]);
    expect(sent[0] + sent[1]).toBe(1);
    expect(await sweep.sendReminders()).toBe(0);
    expect(ctx.mail.sent.filter((m) => m.subject.includes('ends on'))).toHaveLength(1);
  });
});

describe('media and featured limits', () => {
  it('video and image limits follow the plan', async () => {
    const plan = await createPlan();
    const agent = await createAgent(ctx);
    const draft = await createDraft(ctx, agent);
    const addVideo = (url: string) =>
      ctx.http().post(`${PROPERTIES}/${draft.id}/videos`).set(agent.auth).send({ url });
    expect((await addVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).status).toBe(201);
    const blocked = await addVideo('https://vimeo.com/76979871');
    expect(blocked.status).toBe(403);
    expect(blocked.body.details).toMatchObject({ entitlement: 'VIDEOS_PER_PROPERTY', limit: 1 });

    await subscribe(agent, plan.id); // 2 videos per property
    expect((await addVideo('https://vimeo.com/76979871')).status).toBe(201);
    expect((await addVideo('https://vimeo.com/22439234')).status).toBe(403);
  });

  it('storage limits are checked against the bytes actually stored', async () => {
    const finance = await financeAdmin();
    const free = await ctx.prisma.subscriptionPlan.findFirstOrThrow({ where: { isDefault: true } });
    await ctx
      .http()
      .patch(`${PLANS}/${free.id}`)
      .set(finance.auth)
      .send({ entitlements: limits({ PROPERTY_COUNT: 1, STORAGE_MB: 0 }) })
      .expect(200);
    const agent = await createAgent(ctx);
    const draft = await createDraft(ctx, agent);
    const res = await uploadImage(ctx, agent, draft.id, 403, await testImage(400, 300));
    expect(res.body.details).toMatchObject({ entitlement: 'STORAGE_MB', limit: 0 });
    expect(await ctx.prisma.propertyImage.count()).toBe(0);
  });

  it('featured listings are limited by plan, including under concurrency, and released on expiry', async () => {
    const plan = await createPlan({ entitlements: limits({ FEATURED_PROPERTY_COUNT: 1 }) });
    const agent = await createAgent(ctx);
    const first = await createPublished(ctx, agent);

    const notIncluded = await ctx.http().post(`${PROPERTIES}/${first.id}/feature`).set(agent.auth);
    expect(notIncluded.status).toBe(403);
    expect(notIncluded.body.message).toMatch(/not included/);

    await subscribe(agent, plan.id);
    const second = await createPublished(ctx, agent);
    const third = await createPublished(ctx, agent);
    const attempts = await Promise.all(
      [first, second, third].map((p) =>
        ctx.http().post(`${PROPERTIES}/${p.id}/feature`).set(agent.auth),
      ),
    );
    expect(attempts.filter((r) => r.status === 200)).toHaveLength(1);
    expect(attempts.filter((r) => r.status === 403)).toHaveLength(2);
    expect(
      await ctx.prisma.property.count({
        where: { agentProfileId: agent.agentProfileId, featuredAt: { not: null } },
      }),
    ).toBe(1);

    // Drafts cannot be featured.
    const finance = await financeAdmin();
    await ctx
      .http()
      .patch(`${PLANS}/${plan.id}`)
      .set(finance.auth)
      .send({ entitlements: limits({ FEATURED_PROPERTY_COUNT: 5, PROPERTY_COUNT: 5 }) })
      .expect(200);
    const draft = await createDraft(ctx, agent);
    await ctx.http().post(`${PROPERTIES}/${draft.id}/feature`).set(agent.auth).expect(409);

    await endActiveTerm(agent);
    await ctx.app.get(SubscriptionMaintenanceService).reconcileDue();
    expect(
      await ctx.prisma.property.count({
        where: { agentProfileId: agent.agentProfileId, featuredAt: { not: null } },
      }),
    ).toBe(0);
    // Listings themselves are untouched.
    expect(
      await ctx.prisma.property.count({
        where: { agentProfileId: agent.agentProfileId, status: 'PUBLISHED' },
      }),
    ).toBe(3);
  });

  it('concurrent property creation never exceeds a paid plan’s limit', async () => {
    const plan = await createPlan();
    const agent = await createAgent(ctx);
    await subscribe(agent, plan.id);
    await createDraft(ctx, agent);
    await createDraft(ctx, agent);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        (i % 2 ? other : ctx).http().post(PROPERTIES).set(agent.auth).send(completeProperty()),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      await ctx.prisma.property.count({ where: { agentProfileId: agent.agentProfileId } }),
    ).toBe(3);
  });
});

describe('admin subscriptions', () => {
  it('lists, searches, filters and shows payment detail', async () => {
    const plan = await createPlan();
    const a = await createAgent(ctx);
    const b = await createAgent(ctx);
    await subscribe(a, plan.id);
    const { reference } = await subscribe(b, plan.id);
    const finance = await financeAdmin();

    const all = (await ctx.http().get('/api/v1/admin/subscriptions').set(finance.auth).expect(200))
      .body.data;
    expect(all.total).toBe(2);
    const search = (
      await ctx
        .http()
        .get(`/api/v1/admin/subscriptions?search=${encodeURIComponent(b.email)}`)
        .set(finance.auth)
        .expect(200)
    ).body.data;
    expect(search.items.map((i: { agent: { email: string } }) => i.agent.email)).toEqual([b.email]);
    const filtered = (
      await ctx
        .http()
        .get(`/api/v1/admin/subscriptions?status=EXPIRED&planId=${plan.id}`)
        .set(finance.auth)
        .expect(200)
    ).body.data;
    expect(filtered.total).toBe(0);

    const detail = (
      await ctx
        .http()
        .get(`/api/v1/admin/subscriptions/${search.items[0].id}`)
        .set(finance.auth)
        .expect(200)
    ).body.data;
    expect(detail.payments).toEqual([expect.objectContaining({ reference, status: 'SUCCESS' })]);

    const stats = (
      await ctx.http().get('/api/v1/admin/subscriptions/stats').set(finance.auth).expect(200)
    ).body.data;
    expect(stats).toMatchObject({
      agents: 2,
      paidAgents: 2,
      freeAgents: 0,
      revenueKobo: 1_000_000,
      last30Days: { new: 2 },
    });
    expect(stats.byPlan.find((p: { planId: string }) => p.planId === plan.id)).toMatchObject({
      activeSubscribers: 2,
      revenueKobo: 1_000_000,
    });
  });

  it('suspend falls back to the free plan; reactivate restores it; cancel ends it', async () => {
    const plan = await createPlan();
    const agent = await createAgent(ctx);
    await subscribe(agent, plan.id);
    const term = (await terms(agent))[0]!;
    const finance = await financeAdmin();
    const act = (action: string, expected = 200) =>
      ctx
        .http()
        .post(`/api/v1/admin/subscriptions/${term.id}/actions`)
        .set(finance.auth)
        .send({ action, reason: 'Support case 42' })
        .expect(expected);

    await act('SUSPEND');
    expect((await current(agent)).plan.isDefault).toBe(true);
    await act('SUSPEND', 409);
    await act('REACTIVATE');
    expect((await current(agent)).plan.id).toBe(plan.id);
    await act('CANCEL');
    expect((await current(agent)).plan.isDefault).toBe(true);
    await act('REACTIVATE', 409);
    expect(await audits('subscription.suspended')).toBe(1);
    expect(await audits('subscription.reactivated')).toBe(1);
    expect(await audits('subscription.cancelled')).toBe(1);
    await ctx
      .http()
      .post(`/api/v1/admin/subscriptions/${term.id}/actions`)
      .set(finance.auth)
      .send({ action: 'CANCEL' })
      .expect(422); // a reason is required
  });

  it('RBAC: viewing, managing and plan editing are separate permissions', async () => {
    const plan = await createPlan();
    const agent = await createAgent(ctx);
    await subscribe(agent, plan.id);
    const term = (await terms(agent))[0]!;

    const support = await adminAuth(ctx, ['support_admin']); // subscriptions.view only
    await ctx.http().get('/api/v1/admin/subscriptions').set(support.auth).expect(200);
    await ctx.http().get(PLANS).set(support.auth).expect(200);
    await ctx
      .http()
      .post(`/api/v1/admin/subscriptions/${term.id}/actions`)
      .set(support.auth)
      .send({ action: 'SUSPEND', reason: 'nope' })
      .expect(403);
    await ctx
      .http()
      .patch(`${PLANS}/${plan.id}`)
      .set(support.auth)
      .send({ entitlements: limits({ PROPERTY_COUNT: 999 }) })
      .expect(403);

    const general = await adminAuth(ctx, ['admin']); // manage, but no plan pricing
    await ctx.http().post(PLANS).set(general.auth).send({}).expect(403);

    const propertyManager = await adminAuth(ctx, ['property_manager']);
    await ctx.http().get('/api/v1/admin/subscriptions').set(propertyManager.auth).expect(403);

    // Agents never reach admin endpoints and cannot change their own limits.
    await ctx.http().get(PLANS).set(agent.auth).expect(403);
    await ctx
      .http()
      .patch(`${PLANS}/${plan.id}`)
      .set(agent.auth)
      .send({ entitlements: limits({ PROPERTY_COUNT: 999 }) })
      .expect(403);
    expect(
      (
        await ctx.prisma.subscriptionPlanEntitlement.findUniqueOrThrow({
          where: { planId_key: { planId: plan.id, key: 'PROPERTY_COUNT' } },
        })
      ).limit,
    ).toBe(3);
    await ctx.http().get('/api/v1/admin/subscriptions').expect(401);
  });
});

describe('financial integrity', () => {
  it('subscription records cannot be deleted and paid amounts cannot be changed', async () => {
    const plan = await createPlan();
    const agent = await createAgent(ctx);
    const { reference } = await subscribe(agent, plan.id);
    const term = (await terms(agent))[0]!;
    await expect(ctx.prisma.agentSubscription.delete({ where: { id: term.id } })).rejects.toThrow();
    await expect(
      ctx.prisma.subscriptionPayment.update({ where: { reference }, data: { amountKobo: 1n } }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.agentSubscription.update({ where: { id: term.id }, data: { priceKobo: 1n } }),
    ).rejects.toThrow();
    await expect(ctx.prisma.subscriptionPayment.delete({ where: { reference } })).rejects.toThrow();
  });

  it('the database allows only one active term per agent', async () => {
    const plan = await createPlan();
    const agent = await createAgent(ctx);
    await subscribe(agent, plan.id);
    const term = (await terms(agent))[0]!;
    await expect(
      ctx.prisma.agentSubscription.create({
        data: {
          agentProfileId: agent.agentProfileId,
          planId: plan.id,
          status: 'ACTIVE',
          changeType: 'NEW',
          priceKobo: 1n,
          billingInterval: 'MONTHLY',
          currentPeriodStart: term.currentPeriodStart,
          currentPeriodEnd: term.currentPeriodEnd,
        },
      }),
    ).rejects.toThrow();
  });
});
