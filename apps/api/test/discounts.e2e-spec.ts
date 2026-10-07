import type {
  AdminDiscountCodeDetail,
  AdminSubscriptionPlanView,
  NotificationPage,
  PlanEntitlements,
  SubscriptionCheckoutView,
  SubscriptionQuoteView,
} from '@havenhub/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service';
import { adminAuth, customer } from './helpers/booking-helpers';
import { createAgent, createTestContext, type Agent, type TestContext } from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const SUB = '/api/v1/agents/me/subscription';
const CODES = '/api/v1/admin/discount-codes';

const limits: PlanEntitlements = {
  PROPERTY_COUNT: 3,
  IMAGES_PER_PROPERTY: 20,
  VIDEOS_PER_PROPERTY: 2,
  FEATURED_PROPERTY_COUNT: 1,
  STORAGE_MB: 500,
  EVENT_COUNT: 1,
  TOUR_COUNT: 0,
  CLEANING_SERVICE_COUNT: 0,
  HOTEL_COUNT: 0,
};

let admin: Record<string, string>;

async function createPlan(name: string, priceKobo: number, rank: number) {
  const res = await ctx.http().post('/api/v1/admin/subscription-plans').set(admin).send({
    name,
    priceKobo,
    billingInterval: 'MONTHLY',
    rank,
    features: [],
    entitlements: limits,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as AdminSubscriptionPlanView;
}

async function createCode(body: Record<string, unknown>, expected = 201) {
  const res = await ctx.http().post(CODES).set(admin).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(expected);
  return res.body.data as AdminDiscountCodeDetail;
}

const quote = (agent: Agent, planId: string, code?: string) =>
  ctx
    .http()
    .get(`${SUB}/quote?planId=${planId}${code ? `&code=${encodeURIComponent(code)}` : ''}`)
    .set(agent.auth);

async function checkout(agent: Agent, planId: string, code?: string, expected = 201) {
  const res = await ctx
    .http()
    .post(`${SUB}/checkout`)
    .set(agent.auth)
    .send({ planId, ...(code ? { code } : {}) });
  expect(res.status, JSON.stringify(res.body)).toBe(expected);
  return res.body as { data: SubscriptionCheckoutView; code?: string; message?: string };
}

const pay = (agent: Agent, reference: string, outcome: 'success' | 'failed' = 'success') =>
  ctx
    .http()
    .post(`${SUB}/test-checkout/${reference}`)
    .set(agent.auth)
    .send({ outcome })
    .expect(200);

beforeEach(async () => {
  admin = (await adminAuth(ctx, ['super_admin'])).auth;
});

describe('discount codes at checkout', () => {
  it('discount the quote and the charge, and are redeemed once paid', async () => {
    const pro = await createPlan('Pro', 1_500_000, 2);
    await createCode({ code: 'agent10', percentOff: 10 });
    const agent = await createAgent(ctx);

    const q = (await quote(agent, pro.id, 'Agent10').expect(200)).body
      .data as SubscriptionQuoteView;
    expect(q).toMatchObject({
      listPriceKobo: 1_500_000,
      amountKobo: 1_350_000,
      discount: { code: 'AGENT10', label: '10% off', amountOffKobo: 150_000 },
    });

    const { data } = await checkout(agent, pro.id, 'agent10');
    expect(data.amountKobo).toBe(1_350_000);
    const payment = await ctx.prisma.subscriptionPayment.findUniqueOrThrow({
      where: { reference: data.reference },
    });
    expect(payment).toMatchObject({
      amountKobo: 1_350_000n,
      discountKobo: 150_000n,
      discountCode: 'AGENT10',
    });
    await pay(agent, data.reference);

    const redemption = await ctx.prisma.discountRedemption.findFirstOrThrow();
    expect(redemption).toMatchObject({ status: 'REDEEMED', amountOffKobo: 150_000n });
    const term = await ctx.prisma.agentSubscription.findFirstOrThrow({
      where: { agentProfileId: agent.agentProfileId, status: 'ACTIVE' },
    });
    expect(term.priceKobo).toBe(1_350_000n);

    // Used once: the default per-agent limit.
    const again = await quote(agent, pro.id, 'AGENT10').expect(422);
    expect(again.body).toMatchObject({
      code: 'DISCOUNT_CODE_INVALID',
      message: 'You have already used this code.',
    });
    const payments = (await ctx.http().get(`${SUB}/payments`).set(agent.auth).expect(200)).body
      .data;
    expect(payments[0]).toMatchObject({ discountKobo: 150_000, discountCode: 'AGENT10' });
  });

  it('refuse codes for other plans, other agents, expired or unknown — and quote without a code still works', async () => {
    const basic = await createPlan('Basic', 500_000, 1);
    const pro = await createPlan('Pro', 1_500_000, 2);
    const agent = await createAgent(ctx);
    const other = await createAgent(ctx);
    await createCode({ code: 'PROONLY', percentOff: 20, planIds: [pro.id] });
    await createCode({ code: 'FORKEMI', amountOffKobo: 100_000, agentEmails: [other.email] });
    await createCode({
      code: 'OLD',
      percentOff: 10,
      startsAt: '2026-01-01T00:00:00Z',
      endsAt: '2026-02-01T00:00:00Z',
    });

    const msg = async (planId: string, code: string, who = agent) =>
      (await quote(who, planId, code).expect(422)).body.message as string;
    expect(await msg(basic.id, 'PROONLY')).toBe('This code does not apply to the Basic plan.');
    expect(await msg(basic.id, 'FORKEMI')).toBe('This code is not valid.');
    expect(await msg(basic.id, 'NOPE')).toBe('This code is not valid.');
    expect(await msg(basic.id, 'OLD')).toBe('This code has expired.');
    expect((await quote(other, basic.id, 'FORKEMI').expect(200)).body.data.amountKobo).toBe(
      400_000,
    );
    expect((await quote(agent, basic.id).expect(200)).body.data.discount).toBeNull();

    // Checkout refuses the same way and creates nothing.
    const refused = await checkout(agent, basic.id, 'PROONLY', 422);
    expect(refused.code).toBe('DISCOUNT_CODE_INVALID');
    expect(await ctx.prisma.subscriptionPayment.count()).toBe(0);
  });

  it('a failed payment gives the use back', async () => {
    const pro = await createPlan('Pro', 1_500_000, 2);
    await createCode({ code: 'ONCE', percentOff: 10, maxRedemptions: 1 });
    const agent = await createAgent(ctx);
    const other = await createAgent(ctx);

    const first = await checkout(agent, pro.id, 'ONCE');
    // Held by the open checkout.
    expect((await quote(other, pro.id, 'ONCE').expect(422)).body.message).toBe(
      'This code has been fully used.',
    );
    await pay(agent, first.data.reference, 'failed');
    expect(await ctx.prisma.discountRedemption.findFirstOrThrow()).toMatchObject({
      status: 'RELEASED',
    });
    await quote(other, pro.id, 'ONCE').expect(200);
  });

  it('never lets two simultaneous checkouts take the last use', async () => {
    const pro = await createPlan('Pro', 1_500_000, 2);
    await createCode({ code: 'LAST1', percentOff: 10, maxRedemptions: 1 });
    const agents = await Promise.all([createAgent(ctx), createAgent(ctx), createAgent(ctx)]);
    const service = ctx.app.get(SubscriptionsService);
    const results = await Promise.allSettled(
      agents.map((a) =>
        service.checkout({ id: a.userId, email: a.email }, pro.id, 'LAST1', {
          ip: null,
          userAgent: null,
        } as never),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await ctx.prisma.discountRedemption.count()).toBe(1);
  });

  it('cannot bring a plan below ₦100', async () => {
    const cheap = await createPlan('Lite', 50_000, 1);
    await createCode({ code: 'BIGOFF', amountOffKobo: 45_000 });
    const agent = await createAgent(ctx);
    expect((await quote(agent, cheap.id, 'BIGOFF').expect(422)).body.message).toMatch(/below ₦100/);
  });
});

describe('administration', () => {
  it('needs discounts.manage', async () => {
    const support = await adminAuth(ctx, ['support_admin']);
    await ctx.http().get(CODES).set(support.auth).expect(403);
    const finance = await adminAuth(ctx, ['finance_admin']);
    await ctx.http().get(CODES).set(finance.auth).expect(200);
    const c = await customer(ctx);
    await ctx.http().get(CODES).set(c.auth).expect(403);
  });

  it('validates codes and refuses duplicates, free plans and unknown agents', async () => {
    const free = await ctx.prisma.subscriptionPlan.findFirstOrThrow({ where: { isDefault: true } });
    await createCode({ code: 'X', percentOff: 10 }, 422);
    await createCode({ code: 'BOTH', percentOff: 10, amountOffKobo: 1000 }, 422);
    await createCode({ code: 'NONE' }, 422);
    await createCode({ code: 'TOOMUCH', percentOff: 95 }, 422);
    await createCode({ code: 'FREEPLAN', percentOff: 10, planIds: [free.id] }, 422);
    const unknown = await ctx
      .http()
      .post(CODES)
      .set(admin)
      .send({ code: 'WHO', percentOff: 10, agentEmails: ['ghost@example.com'] })
      .expect(422);
    expect(unknown.body.message).toContain('ghost@example.com');
    await createCode({ code: 'DUP', percentOff: 10 });
    await createCode({ code: 'dup', percentOff: 5 }, 409);
  });

  it('can switch a code off (audited) and lists usage', async () => {
    const pro = await createPlan('Pro', 1_500_000, 2);
    const created = await createCode({ code: 'SPRING', percentOff: 25, perUserLimit: 2 });
    const agent = await createAgent(ctx);
    const { data } = await checkout(agent, pro.id, 'SPRING');
    await pay(agent, data.reference);

    const res = await ctx.http().patch(`${CODES}/${created.id}`).set(admin).send({ active: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      active: false,
      redeemed: 1,
      discountGivenKobo: 375_000,
      label: '25% off',
    });
    expect(res.body.data.redemptions[0]).toMatchObject({
      status: 'REDEEMED',
      item: 'Pro',
      user: { email: agent.email },
    });
    expect((await quote(agent, pro.id, 'SPRING').expect(422)).body.message).toBe(
      'This code is not valid.',
    );
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: { in: ['discount_code.created', 'discount_code.updated'] } },
      }),
    ).toBe(2);
    const list = await ctx.http().get(`${CODES}?status=INACTIVE`).set(admin).expect(200);
    expect(list.body.data.items.map((c: { code: string }) => c.code)).toEqual(['SPRING']);
  });

  it('sends the code to the agents who may use it, with a link that applies it', async () => {
    const target = await createAgent(ctx);
    const bystander = await createAgent(ctx);
    const created = await createCode({
      code: 'VIP15',
      percentOff: 15,
      agentEmails: [target.email],
      endsAt: '2099-01-01T00:00:00Z',
    });
    const sent = await ctx.http().post(`${CODES}/${created.id}/send`).set(admin).expect(200);
    expect(sent.body.data).toEqual({ recipients: 1 });

    const inbox = (await ctx.http().get('/api/v1/notifications').set(target.auth).expect(200)).body
      .data as NotificationPage;
    expect(inbox.items[0]).toMatchObject({
      title: 'Discount: 15% off your plan',
      link: '/agent/subscription/plans?code=VIP15',
    });
    expect(inbox.items[0]!.body).toContain('VIP15');
    const other = (await ctx.http().get('/api/v1/notifications').set(bystander.auth).expect(200))
      .body.data as NotificationPage;
    expect(other.total).toBe(0);

    // An open code goes to every active agent; an inactive one cannot be sent.
    const open = await createCode({ code: 'ALL5', percentOff: 5 });
    expect(
      (await ctx.http().post(`${CODES}/${open.id}/send`).set(admin).expect(200)).body.data,
    ).toEqual({ recipients: 2 });
    await ctx.http().patch(`${CODES}/${open.id}`).set(admin).send({ active: false }).expect(200);
    await ctx.http().post(`${CODES}/${open.id}/send`).set(admin).expect(409);
  });
});
