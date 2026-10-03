import { addDays, todayInNigeria } from '@havenhub/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  adminAuth,
  book,
  customer,
  inDays,
  payWithTestProvider,
  rental,
  setPricing,
} from './helpers/booking-helpers';
import { createAdmin, createAgent, createTestContext, type TestContext } from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const today = () => todayInNigeria();
const sum = (rows: { amountKobo: bigint }[]) => Number(rows.reduce((t, r) => t + r.amountKobo, 0n));

/** A paid 2-night stay at a property of `agent` (or a new agent). */
async function paidStay(agent?: Awaited<ReturnType<typeof createAgent>>) {
  const { property, agent: owner } = await rental(
    ctx,
    { pricingPeriod: 'DAILY', priceKobo: 5_000_000, maxGuests: 4, cleaningOption: 'NOT_AVAILABLE' },
    agent,
  );
  const who = await customer(ctx);
  const booking = await book(ctx, who, {
    propertyId: property.id,
    startDate: inDays(7),
    quantity: 2,
  });
  const { payment } = await payWithTestProvider(ctx, who, booking.id);
  return { property, agent: owner, customer: who, booking, payment };
}

describe('platform analytics', () => {
  it('counts users, active users, agents, live listings and confirmed bookings', async () => {
    await setPricing(ctx);
    const viewer = await adminAuth(ctx, ['operations_manager']);
    await paidStay();
    // A user who never signed in is not active.
    await createAdmin(ctx, []);
    // A user whose only session ended 60 days ago is not active in the last 30 days.
    const lapsed = await customer(ctx);
    const old = new Date(Date.now() - 60 * 86_400_000);
    await ctx.prisma.session.updateMany({
      where: { userId: lapsed.id },
      data: { createdAt: old, lastUsedAt: old },
    });

    const res = await ctx
      .http()
      .get('/api/v1/admin/analytics/overview')
      .set(viewer.auth)
      .expect(200);
    const data = res.body.data;
    const users = await ctx.prisma.user.count();
    const withRecentSessions = await ctx.prisma.session.findMany({
      where: { lastUsedAt: { gte: new Date(Date.now() - 31 * 86_400_000) } },
      distinct: ['userId'],
    });
    expect(data.range).toEqual({ from: addDays(today(), -29), to: today() });
    expect(data.users.total).toEqual({ available: true, value: users });
    expect(data.users.new).toEqual({ available: true, value: users });
    expect(data.users.active).toEqual({ available: true, value: withRecentSessions.length });
    expect(data.users.active.value).toBeLessThan(users - 1);
    expect(data.agents.total.value).toBe(1);
    expect(data.agents.verified.value).toBe(1);
    expect(data.listings.PROPERTY).toEqual({ available: true, value: 1 });
    expect(data.listings.EVENT).toEqual({ available: true, value: 0 });
    expect(data.bookings.confirmed).toEqual({ available: true, value: 1 });
    // Features that do not exist yet are "not available", never zero.
    for (const key of ['sales', 'eventTicketSales', 'reviews']) {
      expect(data[key]).toMatchObject({ available: false });
      expect(data[key].reason).toEqual(expect.any(String));
    }

    // The lapsed user is active in a range covering their session.
    const past = await ctx
      .http()
      .get('/api/v1/admin/analytics/overview')
      .query({ from: addDays(today(), -61), to: addDays(today(), -59) })
      .set(viewer.auth)
      .expect(200);
    expect(past.body.data.users.active.value).toBe(1);
    expect(past.body.data.bookings.confirmed.value).toBe(0);
  });

  it('validates the date range', async () => {
    const viewer = await adminAuth(ctx, ['operations_manager']);
    for (const query of [
      { from: '2026-02-30' },
      { from: '2026-09-10', to: '2026-09-01' },
      { from: '2025-01-01', to: '2026-06-01' },
      { from: 'yesterday' },
    ]) {
      await ctx
        .http()
        .get('/api/v1/admin/analytics/overview')
        .query(query)
        .set(viewer.auth)
        .expect(422);
    }
  });
});

describe('financial analytics', () => {
  it('reports gross revenue by payment date, with refunds, commission, VAT and subscriptions separate', async () => {
    await setPricing(ctx);
    const first = await paidStay();
    const second = await paidStay();
    // A completed refund of the second payment.
    await ctx.prisma.refund.create({
      data: {
        bookingId: second.booking.id,
        paymentId: (
          await ctx.prisma.payment.findUniqueOrThrow({
            where: { reference: second.payment.reference },
          })
        ).id,
        amountKobo: 3_000_000n,
        status: 'COMPLETED',
        reason: 'QA refund',
        requestedBy: 'CUSTOMER',
        completedAt: new Date(),
      },
    });
    // A successful subscription payment.
    const plan = await ctx.prisma.subscriptionPlan.findFirstOrThrow({ where: { isDefault: true } });
    await ctx.prisma.subscriptionPayment.create({
      data: {
        agentProfileId: first.agent.agentProfileId,
        planId: plan.id,
        provider: 'TEST',
        reference: 'HHS-ANALYTICS-1',
        amountKobo: 1_500_000n,
        billingInterval: 'MONTHLY',
        planName: 'Pro',
        status: 'SUCCESS',
        paidAt: new Date(),
      },
    });

    const finance = await adminAuth(ctx, ['finance_admin']);
    const res = await ctx
      .http()
      .get('/api/v1/admin/analytics/financial')
      .set(finance.auth)
      .expect(200);
    const data = res.body.data;

    const payments = await ctx.prisma.payment.findMany({ where: { status: 'SUCCESS' } });
    const ledger = async (type: 'PLATFORM_COMMISSION' | 'PLATFORM_SERVICE_FEE' | 'VAT_PAYABLE') =>
      sum(await ctx.prisma.ledgerEntry.findMany({ where: { type, refundId: null } }));
    expect(payments).toHaveLength(2);
    expect(data.revenueKobo).toEqual({ available: true, value: sum(payments) });
    expect(data.successfulPayments.value).toBe(2);
    expect(data.refundsKobo).toEqual({ available: true, value: 3_000_000 });
    expect(data.refunds.value).toBe(1);
    expect(data.commissionKobo.value).toBe(await ledger('PLATFORM_COMMISSION'));
    expect(data.serviceFeeKobo.value).toBe(await ledger('PLATFORM_SERVICE_FEE'));
    expect(data.vatKobo.value).toBe(await ledger('VAT_PAYABLE'));
    const bookings = await ctx.prisma.booking.findMany();
    expect(data.commissionKobo.value).toBe(
      sum(bookings.map((b) => ({ amountKobo: b.agentCommissionKobo }))),
    );
    expect(data.vatKobo.value).toBe(sum(bookings.map((b) => ({ amountKobo: b.vatKobo }))));
    expect(data.subscriptionRevenueKobo).toEqual({ available: true, value: 1_500_000 });
    expect(data.withdrawalsKobo).toMatchObject({ available: false });
    expect(data.eventTicketSalesKobo).toMatchObject({ available: false });
    // Integer kobo throughout.
    for (const key of ['revenueKobo', 'commissionKobo', 'vatKobo', 'serviceFeeKobo']) {
      expect(Number.isInteger(data[key].value)).toBe(true);
    }

    // Nothing was paid yesterday.
    const yesterday = addDays(today(), -1);
    const before = await ctx
      .http()
      .get('/api/v1/admin/analytics/financial')
      .query({ from: yesterday, to: yesterday })
      .set(finance.auth)
      .expect(200);
    expect(before.body.data.revenueKobo.value).toBe(0);
    expect(before.body.data.subscriptionRevenueKobo.value).toBe(0);
  });

  it('needs analytics.financial, separately from analytics.view', async () => {
    const ops = await adminAuth(ctx, ['operations_manager']);
    await ctx.http().get('/api/v1/admin/analytics/overview').set(ops.auth).expect(200);
    await ctx.http().get('/api/v1/admin/analytics/financial').set(ops.auth).expect(403);
    for (const role of ['content_manager', 'support_admin', 'property_manager']) {
      const auth = (await adminAuth(ctx, [role])).auth;
      await ctx.http().get('/api/v1/admin/analytics/overview').set(auth).expect(403);
      await ctx.http().get('/api/v1/admin/analytics/financial').set(auth).expect(403);
    }
    const finance = await adminAuth(ctx, ['finance_admin']);
    await ctx.http().get('/api/v1/admin/analytics/financial').set(finance.auth).expect(200);
    const buyer = await customer(ctx);
    await ctx.http().get('/api/v1/admin/analytics/financial').set(buyer.auth).expect(403);
    await ctx.http().get('/api/v1/admin/analytics/overview').expect(401);
  });
});

describe('agent analytics', () => {
  it("only ever covers the signed-in agent's own data", async () => {
    await setPricing(ctx);
    const a = await paidStay();
    const b = await paidStay();
    const day = new Date(`${today()}T00:00:00Z`);
    await ctx.prisma.propertyViewDaily.createMany({
      data: [
        { propertyId: a.property.id, day, views: 8 },
        { propertyId: b.property.id, day, views: 3 },
      ],
    });

    const mine = await ctx
      .http()
      .get('/api/v1/agents/me/analytics')
      // Smuggled identifiers are ignored: scope comes from the session.
      .query({ agentProfileId: b.agent.agentProfileId, agentId: b.agent.userId })
      .set(a.agent.auth)
      .expect(200);
    const paymentA = await ctx.prisma.payment.findUniqueOrThrow({
      where: { reference: a.payment.reference },
    });
    const earningA = await ctx.prisma.agentEarning.findUniqueOrThrow({
      where: { bookingId: a.booking.id },
    });
    expect(mine.body.data).toMatchObject({
      propertyViews: { available: true, value: 8 },
      bookings: { available: true, value: 1 },
      conversion: { available: true, value: 1 / 8 },
      revenueKobo: { available: true, value: Number(paymentA.amountKobo) },
      earningsKobo: { available: true, value: Number(earningA.amountKobo) },
      reviews: { available: false },
      eventSalesKobo: { available: false },
    });

    const theirs = await ctx
      .http()
      .get('/api/v1/agents/me/analytics')
      .set(b.agent.auth)
      .expect(200);
    expect(theirs.body.data.propertyViews.value).toBe(3);

    // No views: conversion is not available rather than a misleading number.
    const fresh = await createAgent(ctx);
    const empty = await ctx.http().get('/api/v1/agents/me/analytics').set(fresh.auth).expect(200);
    expect(empty.body.data.conversion).toMatchObject({ available: false });
    expect(empty.body.data.revenueKobo.value).toBe(0);

    // Not for customers or administrators.
    await ctx.http().get('/api/v1/agents/me/analytics').set(a.customer.auth).expect(403);
    const admin = await adminAuth(ctx, ['super_admin']);
    await ctx.http().get('/api/v1/agents/me/analytics').set(admin.auth).expect(403);
  });
});
