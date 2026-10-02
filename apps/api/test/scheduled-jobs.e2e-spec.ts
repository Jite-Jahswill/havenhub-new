import type { AdminBookingDetail } from '@havenhub/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DistributedLockService } from '../src/infrastructure/redis/distributed-lock.service';
import { RedisService } from '../src/infrastructure/redis/redis.service';
import {
  BOOKING_JOBS,
  BookingMaintenanceService,
} from '../src/modules/bookings/booking-maintenance.service';
import { BookingStateService } from '../src/modules/bookings/booking-state.service';
import { RefundsService } from '../src/modules/finance/refunds.service';
import {
  adminAuth,
  book,
  customer,
  inDays,
  payWithTestProvider,
  rental,
  setPricing,
} from './helpers/booking-helpers';
import { createTestContext, type TestContext } from './helpers/test-app';

/**
 * Phase 3.1 hardening: scheduled jobs may run on several API instances at
 * once. `ctx` and `other` are two full application instances sharing one
 * database and one Redis — two API servers.
 */
let ctx: TestContext;
let other: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
  other = await createTestContext();
});
beforeEach(async () => {
  await ctx.reset();
  await setPricing(ctx);
});
afterAll(async () => {
  await other.close();
  await ctx.close();
});

const locks = () => ctx.app.get(DistributedLockService);
const redis = () => ctx.app.get(RedisService).client;
const sweepOf = (app: TestContext) => app.app.get(BookingMaintenanceService);
const lockKey = (name: string) => `havenhub:lock:${name}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const audits = (action: string) => ctx.prisma.auditLog.count({ where: { action } });

async function paidBooking(startInDays: number, nights = 3) {
  const { property } = await rental(ctx);
  const c = await customer(ctx);
  const b = await book(ctx, c, {
    propertyId: property.id,
    startDate: inDays(startInDays),
    quantity: nights,
  });
  await payWithTestProvider(ctx, c, b.id);
  return { customer: c, booking: b };
}

async function lapsedHold() {
  const { property } = await rental(ctx);
  const c = await customer(ctx);
  const b = await book(ctx, c, { propertyId: property.id, startDate: inDays(10), quantity: 2 });
  await ctx.prisma.booking.update({
    where: { id: b.id },
    data: { holdExpiresAt: new Date(Date.now() - 1000) },
  });
  return b;
}

describe('distributed lock', () => {
  it('only one holder at a time; released locks can be taken again', async () => {
    const first = await locks().tryAcquire('test:exclusive', 10_000);
    expect(first).not.toBeNull();
    expect(await other.app.get(DistributedLockService).tryAcquire('test:exclusive', 10_000)).toBe(
      null,
    );
    await first!.release();
    expect(await locks().tryAcquire('test:exclusive', 10_000)).not.toBeNull();
  });

  it('concurrent acquisitions: exactly one wins', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        (i % 2 ? other : ctx).app.get(DistributedLockService).tryAcquire('test:race', 10_000),
      ),
    );
    expect(attempts.filter(Boolean)).toHaveLength(1);
  });

  it('a holder whose lease lapsed cannot release or renew the new holder’s lock', async () => {
    const stale = await locks().tryAcquire('test:lapsed', 100);
    await sleep(200);
    const current = await locks().tryAcquire('test:lapsed', 10_000);
    expect(current).not.toBeNull();

    await stale!.release();
    expect(await stale!.renew()).toBe(false);
    expect(await redis().get(lockKey('test:lapsed'))).toBe(current!.token);
  });

  it('a crashed holder (never released) only blocks until its lease expires', async () => {
    await locks().tryAcquire('test:crash', 150); // the "crashed" worker: no release
    const ran = vi.fn(() => Promise.resolve('done'));
    expect(await locks().withLock('test:crash', 10_000, ran)).toEqual({ acquired: false });
    expect(ran).not.toHaveBeenCalled();

    await sleep(250);
    expect(await locks().withLock('test:crash', 10_000, ran)).toEqual({
      acquired: true,
      result: 'done',
    });
  });

  it('withLock releases the lock when the job throws, so it can be retried', async () => {
    await expect(
      locks().withLock('test:throws', 10_000, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(await redis().exists(lockKey('test:throws'))).toBe(0);
    expect(await locks().withLock('test:throws', 10_000, () => Promise.resolve(1))).toEqual({
      acquired: true,
      result: 1,
    });
  });

  it('long jobs keep their lease alive past the TTL', async () => {
    const run = locks().withLock('test:long', 150, async () => {
      await sleep(500);
      return 'finished';
    });
    await sleep(300); // past the original TTL
    expect(await other.app.get(DistributedLockService).tryAcquire('test:long', 10_000)).toBe(null);
    expect(await run).toEqual({ acquired: true, result: 'finished' });
    expect(await redis().exists(lockKey('test:long'))).toBe(0);
  });
});

describe('scheduled jobs across API instances', () => {
  it('two instances sweeping at once change each record exactly once', async () => {
    const hold = await lapsedHold();
    const started = await paidBooking(1, 1); // starts tomorrow, ends the day after
    const results = await Promise.all([
      sweepOf(ctx).runOnce(inDays(3)),
      sweepOf(other).runOnce(inDays(3)),
      sweepOf(ctx).runOnce(inDays(3)),
      sweepOf(other).runOnce(inDays(3)),
    ]);

    const total = (key: 'expired' | 'released' | 'completed') =>
      results.reduce((sum, r) => sum + (r[key] ?? 0), 0);
    expect(total('expired')).toBe(1);
    expect(total('released')).toBe(1);
    expect(total('completed')).toBe(1);

    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe(
      'EXPIRED',
    );
    expect(
      (await ctx.prisma.booking.findUniqueOrThrow({ where: { id: started.booking.id } })).status,
    ).toBe('COMPLETED');
    expect(await audits('booking.expired')).toBe(1);
    expect(await audits('booking.completed')).toBe(1);
    expect(await audits('agent_earning.available')).toBe(1);
    // Every lock was released.
    expect(await redis().keys('havenhub:lock:*')).toEqual([]);
  });

  it('an instance skips a job another instance holds, and changes nothing', async () => {
    const hold = await lapsedHold();
    const held = await other.app
      .get(DistributedLockService)
      .tryAcquire(BOOKING_JOBS.expireHolds, 10_000);

    const result = await sweepOf(ctx).runOnce();
    expect(result.expired).toBeNull();
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe(
      'AWAITING_PAYMENT',
    );

    await held!.release();
    expect((await sweepOf(ctx).runOnce()).expired).toBe(1);
  });

  it('a job held by a crashed instance runs once its lease lapses', async () => {
    const hold = await lapsedHold();
    await other.app.get(DistributedLockService).tryAcquire(BOOKING_JOBS.expireHolds, 200);

    expect((await sweepOf(ctx).runOnce()).expired).toBeNull();
    await sleep(300);
    expect((await sweepOf(ctx).runOnce()).expired).toBe(1);
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe(
      'EXPIRED',
    );
  });

  it('a job that fails mid-run releases its lock and succeeds on retry', async () => {
    const hold = await lapsedHold();
    const state = ctx.app.get(BookingStateService);
    const spy = vi
      .spyOn(state, 'expireStaleHolds')
      .mockRejectedValueOnce(new Error('database blip'));

    await expect(sweepOf(ctx).runOnce()).rejects.toThrow('database blip');
    expect(await redis().exists(lockKey(BOOKING_JOBS.expireHolds))).toBe(0);
    spy.mockRestore();

    expect((await sweepOf(other).runOnce()).expired).toBe(1);
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe(
      'EXPIRED',
    );
  });

  it('with Redis unreachable the sweep fails safely and changes nothing', async () => {
    const hold = await lapsedHold();
    const client = ctx.app.get(RedisService).client;
    const spy = vi.spyOn(client, 'set').mockRejectedValueOnce(new Error('Connection is closed.'));

    await expect(sweepOf(ctx).runOnce()).rejects.toThrow('Connection is closed.');
    spy.mockRestore();
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe(
      'AWAITING_PAYMENT',
    );
  });
});

describe('job steps are idempotent even without the lock', () => {
  it('booking expiration: concurrent runs expire a hold once', async () => {
    const hold = await lapsedHold();
    const state = ctx.app.get(BookingStateService);
    const counts = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        (i % 2 ? other : ctx).prisma.$transaction((tx) => state.expireStaleHolds(tx)),
      ),
    );
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await audits('booking.expired')).toBe(1);
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe(
      'EXPIRED',
    );
  });

  it('earnings release: concurrent runs release an earning once', async () => {
    const { booking } = await paidBooking(1);
    const counts = await Promise.all(
      Array.from({ length: 5 }, (_, i) => sweepOf(i % 2 ? other : ctx).releaseEarnings(inDays(1))),
    );
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await audits('agent_earning.available')).toBe(1);
    const earning = await ctx.prisma.agentEarning.findUniqueOrThrow({
      where: { bookingId: booking.id },
    });
    expect(earning.status).toBe('AVAILABLE');
    expect(earning.availableAt).not.toBeNull();

    // Running again later changes nothing.
    expect(await sweepOf(ctx).releaseEarnings(inDays(2))).toBe(0);
    expect(await audits('agent_earning.available')).toBe(1);
  });

  it('earnings release never touches cancelled bookings or reversed earnings', async () => {
    const { customer: c, booking } = await paidBooking(1);
    await ctx.http().post(`/api/v1/bookings/${booking.id}/cancel`).set(c.auth).send({}).expect(200);
    expect(await sweepOf(ctx).releaseEarnings(inDays(1))).toBe(0);
    expect(
      (await ctx.prisma.agentEarning.findUniqueOrThrow({ where: { bookingId: booking.id } }))
        .status,
    ).toBe('PENDING');
  });

  it('stay completion: concurrent runs complete a stay once', async () => {
    const { booking } = await paidBooking(1, 1);
    const counts = await Promise.all(
      Array.from({ length: 5 }, (_, i) => sweepOf(i % 2 ? other : ctx).completeStays(inDays(2))),
    );
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await audits('booking.completed')).toBe(1);
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe(
      'COMPLETED',
    );
    expect(await sweepOf(ctx).completeStays(inDays(3))).toBe(0);
  });
});

describe('duplicate cancellation and refund processing', () => {
  it('concurrent cancellations: one succeeds and opens exactly one refund', async () => {
    const { customer: c, booking } = await paidBooking(10);
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        ctx.http().post(`/api/v1/bookings/${booking.id}/cancel`).set(c.auth).send({}),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
    expect(await ctx.prisma.refund.count({ where: { bookingId: booking.id } })).toBe(1);
    expect(await audits('booking.cancelled')).toBe(1);
    expect(await audits('refund.requested')).toBe(1);
  });

  it('concurrent approvals and completions reverse the money exactly once', async () => {
    const { customer: c, booking } = await paidBooking(10);
    await ctx.http().post(`/api/v1/bookings/${booking.id}/cancel`).set(c.auth).send({}).expect(200);
    const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { bookingId: booking.id } });
    const finance = await adminAuth(ctx, ['finance_admin']);

    const approvals = await Promise.all(
      Array.from({ length: 4 }, () =>
        ctx
          .http()
          .post(`/api/v1/admin/refunds/${refund.id}/review`)
          .set(finance.auth)
          .send({ action: 'APPROVE' }),
      ),
    );
    expect(approvals.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);

    // Replayed completions (e.g. provider webhooks hitting both instances).
    await Promise.all([
      ctx.app.get(RefundsService).complete(refund.id, null),
      other.app.get(RefundsService).complete(refund.id, null),
      ctx.app.get(RefundsService).complete(refund.id, null),
    ]);

    const refundEntries = await ctx.prisma.ledgerEntry.findMany({ where: { refundId: refund.id } });
    const paymentEntries = await ctx.prisma.ledgerEntry.findMany({
      where: { bookingId: booking.id, refundId: null },
    });
    expect(refundEntries).toHaveLength(paymentEntries.length);
    expect(refundEntries.reduce((s, e) => s + e.amountKobo, 0n)).toBe(-refund.amountKobo);
    expect(await audits('refund.completed')).toBe(1);
    expect(await audits('refund.approved')).toBe(1);
    expect(
      (await ctx.prisma.payment.findUniqueOrThrow({ where: { id: refund.paymentId } })).status,
    ).toBe('REFUNDED');
  });
});

describe('ledger buckets', () => {
  it('the admin view separates the customer payment, caution held, revenue and agent payable', async () => {
    const { property } = await rental(ctx, {
      pricingPeriod: 'DAILY',
      priceKobo: 5_000_000,
      maxGuests: 4,
      cleaningOption: 'AVAILABLE_FOR_FEE',
      cleaningFeeKobo: 1_000_000,
      cautionFeeKobo: 2_000_000,
    });
    const c = await customer(ctx);
    const b = await book(ctx, c, {
      propertyId: property.id,
      startDate: inDays(10),
      quantity: 3,
      addCleaning: true,
    });
    await payWithTestProvider(ctx, c, b.id);
    const finance = await adminAuth(ctx, ['finance_admin']);
    const detail = async (): Promise<AdminBookingDetail> =>
      (await ctx.http().get(`/api/v1/admin/bookings/${b.id}`).set(finance.auth).expect(200)).body
        .data as AdminBookingDetail;

    // ₦150,000 stay + ₦10,000 cleaning + ₦20,000 caution + ₦15,000 fee + ₦1,125 VAT.
    expect((await detail()).ledgerSummary).toEqual({
      customerPaidKobo: 19_612_500,
      customerRefundedKobo: 0,
      revenueKobo: 1_500_000 + 750_000, // service fee + commission
      taxPayableKobo: 112_500,
      agentPayableKobo: 14_250_000 + 1_000_000, // rent − commission + cleaning
      cautionHeldKobo: 2_000_000,
      owedToCustomerKobo: 0,
    });

    await ctx.http().post(`/api/v1/bookings/${b.id}/cancel`).set(c.auth).send({}).expect(200);
    const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { bookingId: b.id } });
    await ctx
      .http()
      .post(`/api/v1/admin/refunds/${refund.id}/review`)
      .set(finance.auth)
      .send({ action: 'APPROVE' })
      .expect(200);
    expect((await detail()).ledgerSummary).toEqual({
      customerPaidKobo: 19_612_500,
      customerRefundedKobo: 19_612_500,
      revenueKobo: 0,
      taxPayableKobo: 0,
      agentPayableKobo: 0,
      cautionHeldKobo: 0,
      owedToCustomerKobo: 0,
    });

    const support = await adminAuth(ctx, ['support_admin']);
    const restricted = (
      await ctx.http().get(`/api/v1/admin/bookings/${b.id}`).set(support.auth).expect(200)
    ).body.data;
    expect(restricted.ledgerSummary).toBeNull();
  });
});
