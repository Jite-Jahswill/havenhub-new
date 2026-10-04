import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { RedisService } from '../src/infrastructure/redis/redis.service';
import { PaymentProviderError } from '../src/modules/finance/providers/payment-provider';
import { BookingStateService } from '../src/modules/bookings/booking-state.service';
import {
  PaymentReconciliationService,
  RECONCILE_BATCH,
} from '../src/modules/payments/payment-reconciliation.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import {
  adminAuth,
  book,
  customer,
  inDays,
  rental,
  setPricing,
  startPayment,
  testProvider,
} from './helpers/booking-helpers';
import { createAgent, createTestContext, type TestContext } from './helpers/test-app';

let ctx: TestContext;
let sweep: PaymentReconciliationService;

beforeAll(async () => {
  ctx = await createTestContext();
  sweep = ctx.app.get(PaymentReconciliationService);
});
beforeEach(async () => {
  await ctx.reset();
  await setPricing(ctx);
});
afterAll(() => ctx.close());

const MIN = 60_000;
const HOUR = 60 * MIN;

/** A booking with one PENDING payment attempt created `ageMs` ago. */
async function pendingBookingPayment(ageMs = 20 * MIN) {
  const { property } = await rental(ctx);
  const who = await customer(ctx);
  const booking = await book(ctx, who, {
    propertyId: property.id,
    startDate: inDays(10),
    quantity: 2,
  });
  const init = await startPayment(ctx, who, booking.id);
  await age(init.reference, ageMs);
  return { booking, reference: init.reference, customer: who };
}

const age = (reference: string, ms: number) =>
  ctx.prisma.payment.update({
    where: { reference },
    data: { createdAt: new Date(Date.now() - ms) },
  });

const payment = (reference: string) =>
  ctx.prisma.payment.findUniqueOrThrow({ where: { reference } });
const bookingRow = (id: string) => ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
const ledgerCount = (bookingId: string) => ctx.prisma.ledgerEntry.count({ where: { bookingId } });

describe('payment reconciliation (A5): booking payments', () => {
  it('settles a paid payment whose webhook never came, exactly once', async () => {
    const p = await pendingBookingPayment();
    await testProvider(ctx).simulate(p.reference, 'success');

    const first = await sweep.runOnce();
    expect(first?.booking).toEqual({ succeeded: 1, failed: 0, pending: 0, errors: 0 });
    expect((await payment(p.reference)).status).toBe('SUCCESS');
    expect((await bookingRow(p.booking.id)).status).toBe('CONFIRMED');
    const entries = await ledgerCount(p.booking.id);
    expect(entries).toBeGreaterThan(0);
    expect(await ctx.prisma.agentEarning.count({ where: { bookingId: p.booking.id } })).toBe(1);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'payment.succeeded', actorId: null } }),
    ).toBe(1);

    // Later runs and a late webhook-style settle change nothing.
    expect((await sweep.runOnce())?.booking).toEqual({
      succeeded: 0,
      failed: 0,
      pending: 0,
      errors: 0,
    });
    await ctx.app.get(PaymentsService).settle(p.reference);
    expect(await ledgerCount(p.booking.id)).toBe(entries);
    expect(await ctx.prisma.agentEarning.count({ where: { bookingId: p.booking.id } })).toBe(1);
  });

  it('leaves provider-pending payments pending and applies the existing failure path', async () => {
    const pending = await pendingBookingPayment();
    const failed = await pendingBookingPayment();
    await testProvider(ctx).simulate(failed.reference, 'failed');

    const result = await sweep.runOnce();
    expect(result?.booking).toEqual({ succeeded: 0, failed: 1, pending: 1, errors: 0 });
    expect((await payment(pending.reference)).status).toBe('PENDING');
    expect(await payment(failed.reference)).toMatchObject({
      status: 'FAILED',
      failureReason: 'Declined (simulated)',
    });
    expect((await bookingRow(failed.booking.id)).status).toBe('AWAITING_PAYMENT');
    expect(await ledgerCount(failed.booking.id)).toBe(0);
  });

  it('only looks at payments between 15 minutes and 72 hours old', async () => {
    const young = await pendingBookingPayment(10 * MIN);
    const old = await pendingBookingPayment(73 * HOUR);
    const edge = await pendingBookingPayment(71 * HOUR);
    for (const p of [young, old, edge]) await testProvider(ctx).simulate(p.reference, 'success');
    const verify = vi.spyOn(testProvider(ctx), 'verify');
    try {
      expect((await sweep.runOnce())?.booking.succeeded).toBe(1);
      expect(verify.mock.calls.map(([reference]) => reference)).toEqual([edge.reference]);
    } finally {
      verify.mockRestore();
    }
    expect((await payment(young.reference)).status).toBe('PENDING');
    expect((await payment(old.reference)).status).toBe('PENDING');
    expect((await payment(edge.reference)).status).toBe('SUCCESS');
  });

  it('keeps the existing amount/currency/reference checks (mismatch is never confirmed)', async () => {
    const p = await pendingBookingPayment();
    await testProvider(ctx).simulate(p.reference, 'success', { amountKobo: '100' });
    expect((await sweep.runOnce())?.booking.failed).toBe(1);
    expect((await payment(p.reference)).failureReason).toMatch(/Verification mismatch: amount/);
    expect((await bookingRow(p.booking.id)).status).toBe('AWAITING_PAYMENT');
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'payment.verification_mismatch' } }),
    ).toBe(1);
  });

  it('a late success takes the existing unallocated-money and refund path', async () => {
    const p = await pendingBookingPayment(30 * MIN);
    // The hold lapsed and the booking expired before the money was confirmed.
    await ctx.prisma.booking.update({
      where: { id: p.booking.id },
      data: { holdExpiresAt: new Date(Date.now() - 5 * MIN) },
    });
    await ctx.prisma.$transaction((tx) => ctx.app.get(BookingStateService).expireStaleHolds(tx));
    expect((await bookingRow(p.booking.id)).status).toBe('EXPIRED');

    await testProvider(ctx).simulate(p.reference, 'success');
    expect((await sweep.runOnce())?.booking.succeeded).toBe(1);
    const paid = await payment(p.reference);
    expect(paid.status).toBe('SUCCESS');
    expect(
      await ctx.prisma.ledgerEntry.count({ where: { paymentId: paid.id, type: 'UNALLOCATED' } }),
    ).toBe(1);
    expect(
      await ctx.prisma.refund.findUniqueOrThrow({ where: { paymentId: paid.id } }),
    ).toMatchObject({
      status: 'REQUESTED',
      requestedBy: 'SYSTEM',
    });
    expect((await bookingRow(p.booking.id)).status).toBe('EXPIRED');
  });

  it('survives provider errors and unknown references without touching payment state', async () => {
    const unknown = await pendingBookingPayment();
    const flaky = await pendingBookingPayment();
    const good = await pendingBookingPayment();
    await ctx.app.get(RedisService).client.del(`testpay:${unknown.reference}`);
    await testProvider(ctx).simulate(good.reference, 'success');
    await testProvider(ctx).simulate(flaky.reference, 'success');
    const verify = testProvider(ctx).verify.bind(testProvider(ctx));
    const spy = vi
      .spyOn(testProvider(ctx), 'verify')
      .mockImplementation((reference) =>
        reference === flaky.reference
          ? Promise.reject(
              new PaymentProviderError('Paystack unreachable', { outcomeUnknown: true }),
            )
          : verify(reference),
      );
    try {
      expect((await sweep.runOnce())?.booking).toEqual({
        succeeded: 1,
        failed: 0,
        pending: 0,
        errors: 2,
      });
    } finally {
      spy.mockRestore();
    }
    expect((await payment(unknown.reference)).status).toBe('PENDING');
    expect((await payment(flaky.reference)).status).toBe('PENDING');
    expect((await payment(good.reference)).status).toBe('SUCCESS');
    // The provider recovers: the next run settles it.
    expect((await sweep.runOnce())?.booking.succeeded).toBe(1);
    expect((await payment(flaky.reference)).status).toBe('SUCCESS');
  });

  it('a webhook racing the sweep settles the payment once', async () => {
    const p = await pendingBookingPayment();
    await testProvider(ctx).simulate(p.reference, 'success');
    await Promise.all([
      sweep.runOnce(),
      ctx.app.get(PaymentsService).settle(p.reference),
      ctx.app.get(PaymentsService).settle(p.reference),
    ]);
    expect((await payment(p.reference)).status).toBe('SUCCESS');
    expect(await ctx.prisma.agentEarning.count({ where: { bookingId: p.booking.id } })).toBe(1);
    expect(
      await ctx.prisma.ledgerEntry.count({
        where: { sourceKey: `payment:${(await payment(p.reference)).id}` },
      }),
    ).toBe(await ledgerCount(p.booking.id));
    expect(await ctx.prisma.auditLog.count({ where: { action: 'payment.succeeded' } })).toBe(1);
  });

  it('runs on one instance at a time', async () => {
    const p = await pendingBookingPayment();
    await testProvider(ctx).simulate(p.reference, 'success');
    const results = await Promise.all([sweep.runOnce(), sweep.runOnce(), sweep.runOnce()]);
    expect(results.filter((r) => r === null).length).toBe(2);
    expect(await ctx.prisma.agentEarning.count({ where: { bookingId: p.booking.id } })).toBe(1);
  });
});

describe('payment reconciliation (A5): subscription payments and bounds', () => {
  async function pendingSubscriptionPayment(ageMs = 20 * MIN) {
    const finance = await adminAuth(ctx, ['finance_admin']);
    const plan = (
      await ctx
        .http()
        .post('/api/v1/admin/subscription-plans')
        .set(finance.auth)
        .send({
          name: `Starter ${randomBytes(3).toString('hex')}`,
          priceKobo: 500_000,
          billingInterval: 'MONTHLY',
          rank: 1,
          features: ['More listings'],
          entitlements: {
            PROPERTY_COUNT: 3,
            IMAGES_PER_PROPERTY: 20,
            VIDEOS_PER_PROPERTY: 2,
            FEATURED_PROPERTY_COUNT: 1,
            STORAGE_MB: 500,
            EVENT_COUNT: 1,
            TOUR_COUNT: 0,
            CLEANING_SERVICE_COUNT: 0,
            HOTEL_COUNT: 0,
          },
        })
    ).body.data as { id: string };
    const agent = await createAgent(ctx);
    const checkout = await ctx
      .http()
      .post('/api/v1/agents/me/subscription/checkout')
      .set(agent.auth)
      .send({ planId: plan.id });
    expect(checkout.status, JSON.stringify(checkout.body)).toBe(201);
    const reference = checkout.body.data.reference as string;
    await ctx.prisma.subscriptionPayment.update({
      where: { reference },
      data: { createdAt: new Date(Date.now() - ageMs) },
    });
    return { agent, reference };
  }

  it('settles a paid subscription payment and activates the plan once', async () => {
    const s = await pendingSubscriptionPayment();
    await testProvider(ctx).simulate(s.reference, 'success');
    expect((await sweep.runOnce())?.subscription).toEqual({
      succeeded: 1,
      failed: 0,
      pending: 0,
      errors: 0,
    });
    const paid = await ctx.prisma.subscriptionPayment.findUniqueOrThrow({
      where: { reference: s.reference },
    });
    expect(paid.status).toBe('SUCCESS');
    expect(paid.subscriptionId).not.toBeNull();
    const terms = await ctx.prisma.agentSubscription.count({
      where: { agentProfileId: s.agent.agentProfileId },
    });
    expect((await sweep.runOnce())?.subscription.succeeded).toBe(0);
    expect(
      await ctx.prisma.agentSubscription.count({
        where: { agentProfileId: s.agent.agentProfileId },
      }),
    ).toBe(terms);
  });

  it('leaves young, old and provider-pending subscription payments alone', async () => {
    const young = await pendingSubscriptionPayment(5 * MIN);
    const pending = await pendingSubscriptionPayment();
    const old = await pendingSubscriptionPayment(80 * HOUR);
    await testProvider(ctx).simulate(young.reference, 'success');
    await testProvider(ctx).simulate(old.reference, 'success');
    expect((await sweep.runOnce())?.subscription).toEqual({
      succeeded: 0,
      failed: 0,
      pending: 1,
      errors: 0,
    });
    for (const s of [young, pending, old]) {
      expect(
        (
          await ctx.prisma.subscriptionPayment.findUniqueOrThrow({
            where: { reference: s.reference },
          })
        ).status,
      ).toBe('PENDING');
    }
  });

  it('bounds provider look-ups per run and works through the backlog in turn', async () => {
    const agent = await createAgent(ctx);
    const plan = await ctx.prisma.subscriptionPlan.findFirstOrThrow({ where: { isDefault: true } });
    const total = RECONCILE_BATCH + 3;
    for (let i = 0; i < total; i++) {
      await ctx.prisma.subscriptionPayment.create({
        data: {
          agentProfileId: agent.agentProfileId,
          planId: plan.id,
          provider: 'TEST',
          reference: `HHS-backlog-${i}-${randomBytes(4).toString('hex')}`,
          amountKobo: 500_000n,
          billingInterval: 'MONTHLY',
          planName: 'Starter',
          createdAt: new Date(Date.now() - 2 * HOUR + i * MIN),
        },
      });
    }
    const verify = vi.spyOn(testProvider(ctx), 'verify');
    try {
      // No provider record exists for these: every look-up errors, nothing changes.
      expect((await sweep.runOnce())?.subscription.errors).toBe(RECONCILE_BATCH);
      expect((await sweep.runOnce())?.subscription.errors).toBe(3);
      expect((await sweep.runOnce())?.subscription.errors).toBe(RECONCILE_BATCH);
      const checked = new Set(verify.mock.calls.map(([reference]) => reference));
      expect(checked.size).toBe(total);
      expect(verify).toHaveBeenCalledTimes(RECONCILE_BATCH * 2 + 3);
    } finally {
      verify.mockRestore();
    }
    expect(await ctx.prisma.subscriptionPayment.count({ where: { status: 'PENDING' } })).toBe(
      total,
    );
  });
});
