import type { AdminDiscountCodeDetail, BookingQuote } from '@havenhub/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BookingMaintenanceService } from '../src/modules/bookings/booking-maintenance.service';
import { BookingsService } from '../src/modules/bookings/bookings.service';
import {
  adminAuth,
  book,
  customer,
  inDays,
  ledgerTotals,
  payWithTestProvider,
  rental,
  setPricing,
} from './helpers/booking-helpers';
import {
  createAgent,
  createTestContext,
  testImage,
  type Agent,
  type TestContext,
} from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const PROMOS = '/api/v1/agents/me/promo-codes';

async function createPromo(agent: Agent, body: Record<string, unknown>, expected = 201) {
  const res = await ctx.http().post(PROMOS).set(agent.auth).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(expected);
  return res.body.data as AdminDiscountCodeDetail;
}

const quote = (body: Record<string, unknown>) =>
  ctx.http().post('/api/v1/bookings/quote').send(body);

/** ₦50,000 a night, 10% listing discount. */
const DISCOUNTED = {
  pricingPeriod: 'DAILY',
  priceKobo: 5_000_000,
  discountPercent: 10,
  maxGuests: 4,
  cleaningOption: 'NOT_AVAILABLE',
};

describe('agent promo codes at booking', () => {
  it('come off the stay after the listing discount, are agent-funded, and are redeemed when paid', async () => {
    await setPricing(ctx);
    const { agent, property } = await rental(ctx, DISCOUNTED);
    await createPromo(agent, { code: 'stay10', percentOff: 10 });
    const stay = { propertyId: property.id, startDate: inDays(10), quantity: 2 };

    const plain = (await quote(stay).expect(200)).body.data as BookingQuote;
    const res = await quote({ ...stay, code: 'Stay10' }).expect(200);
    const promoted = res.body.data as BookingQuote;
    // Rent 10,000,000 − listing 1,000,000 = 9,000,000; promo 10% of that.
    expect(promoted.promo).toEqual({ code: 'STAY10', label: '10% off', amountOffKobo: 900_000 });
    expect(promoted.lines.find((l) => l.kind === 'PROMO_DISCOUNT')).toMatchObject({
      label: 'Promo code STAY10 (10% off)',
      amountKobo: -900_000,
    });
    expect(promoted.totalKobo).toBeLessThan(plain.totalKobo);

    const c = await customer(ctx);
    const b = await book(ctx, c, {
      ...stay,
      code: 'STAY10',
      expectedTotalKobo: promoted.totalKobo,
    });
    expect(b.totalKobo).toBe(promoted.totalKobo);
    const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(row).toMatchObject({
      promoCode: 'STAY10',
      promoDiscountKobo: 900_000n,
      stayKobo: 8_100_000n,
    });
    expect(await ctx.prisma.discountRedemption.findFirstOrThrow()).toMatchObject({
      status: 'PENDING',
      bookingId: b.id,
      userId: c.id,
    });

    await payWithTestProvider(ctx, c, b.id);
    const payment = await ctx.prisma.payment.findFirstOrThrow({
      where: { bookingId: b.id, status: 'SUCCESS' },
    });
    expect(await ctx.prisma.discountRedemption.findFirstOrThrow()).toMatchObject({
      status: 'REDEEMED',
    });
    // The ledger still balances to the (discounted) amount paid; the agent's earning is
    // the reduced stay minus commission.
    const { bySource } = await ledgerTotals(ctx, b.id);
    expect(bySource.get(`payment:${payment.id}`)).toBe(BigInt(promoted.totalKobo));
    const earning = await ctx.prisma.agentEarning.findUniqueOrThrow({ where: { bookingId: b.id } });
    expect(earning.amountKobo).toBe(row.stayKobo - row.agentCommissionKobo);

    // One use per customer by default.
    const again = await ctx
      .http()
      .post('/api/v1/bookings')
      .set(c.auth)
      .send({ ...stay, startDate: inDays(30), code: 'STAY10' })
      .expect(422);
    expect(again.body).toMatchObject({
      code: 'DISCOUNT_CODE_INVALID',
      message: 'You have already used this code.',
    });
    expect(agent.agentProfileId).toBeDefined();
  });

  it('work only on the owning agent’s (chosen) properties; agents may reuse each other’s names', async () => {
    await setPricing(ctx);
    // The free plan allows one property; this agent needs two.
    const free = await ctx.prisma.subscriptionPlan.findFirstOrThrow({ where: { isDefault: true } });
    await ctx.prisma.subscriptionPlanEntitlement.update({
      where: { planId_key: { planId: free.id, key: 'PROPERTY_COUNT' } },
      data: { limit: 5 },
    });
    const { agent: a, property: first } = await rental(ctx);
    const { property: second } = await rental(ctx, undefined, a);
    const { agent: b, property: theirs } = await rental(ctx);
    await createPromo(a, { code: 'SUMMER', amountOffKobo: 500_000, propertyIds: [first.id] });
    await createPromo(b, { code: 'SUMMER', percentOff: 5 });

    const at = (propertyId: string) => ({
      propertyId,
      startDate: inDays(10),
      quantity: 1,
      code: 'SUMMER',
    });
    expect((await quote(at(first.id)).expect(200)).body.data.promo.amountOffKobo).toBe(500_000);
    expect((await quote(at(second.id)).expect(422)).body.message).toBe(
      'This code does not apply to this property.',
    );
    expect((await quote(at(theirs.id)).expect(200)).body.data.promo.label).toBe('5% off');
    expect((await quote({ ...at(first.id), code: 'NOPE' }).expect(422)).body.message).toBe(
      'This code is not valid.',
    );
    // Someone else's property cannot be listed on a code.
    await createPromo(a, { code: 'MINE', percentOff: 5, propertyIds: [theirs.id] }, 422);
  });

  it('are given back when an unpaid booking expires or is cancelled', async () => {
    await setPricing(ctx);
    const { agent, property } = await rental(ctx);
    await createPromo(agent, { code: 'ONCE', percentOff: 10, maxRedemptions: 1 });
    const c = await customer(ctx);
    const other = await customer(ctx);
    const stay = { propertyId: property.id, quantity: 1, code: 'ONCE' };

    const held = await book(ctx, c, { ...stay, startDate: inDays(10) });
    // Held while unpaid.
    const blocked = await ctx
      .http()
      .post('/api/v1/bookings')
      .set(other.auth)
      .send({ ...stay, startDate: inDays(20) })
      .expect(422);
    expect(blocked.body.message).toBe('This code has been fully used.');

    await ctx.prisma.booking.update({
      where: { id: held.id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });
    await ctx.app.get(BookingMaintenanceService).runOnce();
    expect(await ctx.prisma.discountRedemption.findFirstOrThrow()).toMatchObject({
      status: 'RELEASED',
    });

    const next = await book(ctx, other, { ...stay, startDate: inDays(20) });
    await ctx
      .http()
      .post(`/api/v1/bookings/${next.id}/cancel`)
      .set(other.auth)
      .send({})
      .expect(200);
    expect(
      await ctx.prisma.discountRedemption.findFirstOrThrow({ where: { bookingId: next.id } }),
    ).toMatchObject({ status: 'RELEASED' });
  });

  it('never lets two simultaneous bookings take the last use', async () => {
    await setPricing(ctx);
    const { agent, property } = await rental(ctx);
    await createPromo(agent, { code: 'LAST', percentOff: 10, maxRedemptions: 1 });
    const customers = await Promise.all([customer(ctx), customer(ctx), customer(ctx)]);
    const service = ctx.app.get(BookingsService);
    const results = await Promise.allSettled(
      customers.map((c, i) =>
        service.create(
          c.id,
          {
            propertyId: property.id,
            startDate: inDays(10 + i * 5),
            quantity: 1,
            addCleaning: false,
            code: 'LAST',
          },
          { ip: null, userAgent: null } as never,
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await ctx.prisma.discountRedemption.count()).toBe(1);
  });
});

describe('agent promo code management', () => {
  it('lists, shows and changes only the agent’s own codes; customers’ emails stay private', async () => {
    await setPricing(ctx);
    const { agent, property } = await rental(ctx);
    const other = await createAgent(ctx);
    const created = await createPromo(agent, {
      code: 'WEEKEND',
      percentOff: 15,
      description: 'For returning guests',
    });
    await createPromo(other, { code: 'OTHER', percentOff: 5 });

    const list = await ctx.http().get(PROMOS).set(agent.auth).expect(200);
    expect(list.body.data.items.map((c: { code: string }) => c.code)).toEqual(['WEEKEND']);
    await ctx.http().get(`${PROMOS}/${created.id}`).set(other.auth).expect(404);
    await ctx
      .http()
      .patch(`${PROMOS}/${created.id}`)
      .set(other.auth)
      .send({ active: false })
      .expect(404);

    const c = await customer(ctx);
    const b = await book(ctx, c, {
      propertyId: property.id,
      startDate: inDays(10),
      quantity: 1,
      code: 'WEEKEND',
    });
    const detail = (await ctx.http().get(`${PROMOS}/${created.id}`).set(agent.auth).expect(200))
      .body.data as AdminDiscountCodeDetail;
    expect(detail.redemptions[0]).toMatchObject({
      reference: b.reference,
      status: 'PENDING',
      user: { email: null },
    });
    expect(detail.pending).toBe(1);

    const off = await ctx
      .http()
      .patch(`${PROMOS}/${created.id}`)
      .set(agent.auth)
      .send({ active: false })
      .expect(200);
    expect(off.body.data.active).toBe(false);
    expect(
      (
        await quote({
          propertyId: property.id,
          startDate: inDays(20),
          quantity: 1,
          code: 'WEEKEND',
        }).expect(422)
      ).body.message,
    ).toBe('This code is not valid.');

    // Administrators' plan-code list does not include agents' booking codes.
    const admin = await adminAuth(ctx, ['super_admin']);
    const adminList = await ctx
      .http()
      .get('/api/v1/admin/discount-codes')
      .set(admin.auth)
      .expect(200);
    expect(adminList.body.data.total).toBe(0);
    await ctx.http().get(`/api/v1/admin/discount-codes/${created.id}`).set(admin.auth).expect(404);
  });

  it('are for agents only, and suspended agents cannot create them', async () => {
    const c = await customer(ctx);
    await ctx.http().get(PROMOS).set(c.auth).expect(403);
    const suspended = await createAgent(ctx, 'SUSPENDED');
    await createPromo(suspended, { code: 'NOPE', percentOff: 5 }, 403);
  });
});

describe('experience discounts', () => {
  it('show "X% off" on the public listing; 1–90% only', async () => {
    const agent = await createAgent(ctx);
    const admin = await adminAuth(ctx, ['super_admin']);
    await ctx
      .http()
      .patch('/api/v1/admin/settings/moderation')
      .set(admin.auth)
      .send({ CLEANING: false })
      .expect(200);
    const created = await ctx
      .http()
      .post('/api/v1/agents/me/experiences')
      .set(agent.auth)
      .send({
        kind: 'CLEANING',
        title: 'Sparkle home cleaning',
        description: 'Thorough home and apartment cleaning by a vetted, insured team of cleaners.',
        city: 'Ikeja',
        state: 'Lagos',
        discountPercent: 20,
        cleaning: { priceKobo: 2_000_000, serviceAreas: ['Ikeja'], availableDays: ['MON'] },
      })
      .expect(201);
    const { id } = created.body.data as { id: string };
    expect(created.body.data.discountPercent).toBe(20);
    await ctx
      .http()
      .post(`/api/v1/agents/me/experiences/${id}/images`)
      .set(agent.auth)
      .attach('file', await testImage(), { filename: 'p.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const published = await ctx
      .http()
      .post(`/api/v1/agents/me/experiences/${id}/submit`)
      .set(agent.auth)
      .expect(200);

    const card = (await ctx.http().get('/api/v1/experiences?kind=CLEANING').expect(200)).body.data
      .items[0];
    expect(card).toMatchObject({ discountPercent: 20, priceFromKobo: 2_000_000 });
    const detail = await ctx
      .http()
      .get(`/api/v1/experiences/${published.body.data.slug}`)
      .expect(200);
    expect(detail.body.data.discountPercent).toBe(20);

    for (const value of [0, 91, 12.5]) {
      await ctx
        .http()
        .patch(`/api/v1/agents/me/experiences/${id}`)
        .set(agent.auth)
        .send({ discountPercent: value })
        .expect(422);
    }
    const cleared = await ctx
      .http()
      .patch(`/api/v1/agents/me/experiences/${id}`)
      .set(agent.auth)
      .send({ discountPercent: null })
      .expect(200);
    expect(cleared.body.data.discountPercent).toBeNull();
  });
});
