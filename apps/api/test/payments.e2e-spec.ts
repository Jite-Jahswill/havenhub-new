import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { RedisService } from '../src/infrastructure/redis/redis.service';
import { RefundsService } from '../src/modules/finance/refunds.service';
import {
  adminAuth,
  book,
  customer,
  inDays,
  ledgerTotals,
  payWithTestProvider,
  paystackWebhook,
  rental,
  setPricing,
  startPayment,
  testProvider,
  type Customer,
} from './helpers/booking-helpers';
import { createTestContext, type TestContext } from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(async () => {
  await ctx.reset();
  await setPricing(ctx);
});
afterAll(() => ctx.close());

/** ₦50,000 × 3 nights + caution ₦20,000 + cleaning ₦10,000. */
async function unpaidBooking(c?: Customer) {
  const { property, agent } = await rental(ctx, {
    pricingPeriod: 'DAILY',
    priceKobo: 5_000_000,
    maxGuests: 4,
    cleaningOption: 'AVAILABLE_FOR_FEE',
    cleaningFeeKobo: 1_000_000,
    cautionFeeKobo: 2_000_000,
  });
  const who = c ?? (await customer(ctx));
  const booking = await book(ctx, who, {
    propertyId: property.id,
    startDate: inDays(10),
    quantity: 3,
    addCleaning: true,
  });
  return { property, agent, customer: who, booking };
}

const verify = (who: Customer, reference: string) =>
  ctx.http().post(`/api/v1/payments/${reference}/verify`).set(who.auth);

const bookingRow = (id: string) => ctx.prisma.booking.findUniqueOrThrow({ where: { id } });
const paymentRow = (reference: string) =>
  ctx.prisma.payment.findUniqueOrThrow({ where: { reference } });

describe('successful payment', () => {
  it('confirms the booking and records the money exactly once', async () => {
    const { customer: c, booking, agent } = await unpaidBooking();
    // 15,000,000 stay + 1,000,000 cleaning + 2,000,000 caution + 1,500,000 fee + 112,500 VAT
    expect(booking.totalKobo).toBe(19_612_500);
    const { payment, verification } = await payWithTestProvider(ctx, c, booking.id);
    expect(verification).toMatchObject({ paymentStatus: 'SUCCESS', bookingStatus: 'CONFIRMED' });

    const b = await bookingRow(booking.id);
    expect(b.status).toBe('CONFIRMED');
    expect(b.confirmedAt).not.toBeNull();
    expect(b.holdExpiresAt).toBeNull();
    const p = await paymentRow(payment.reference);
    expect(p).toMatchObject({ status: 'SUCCESS', amountKobo: 19_612_500n, currency: 'NGN' });
    expect(p.verifiedAt).not.toBeNull();

    const { entries, bySource } = await ledgerTotals(ctx, booking.id);
    const amount = (type: string) => entries.find((e) => e.type === type)?.amountKobo;
    expect(amount('PLATFORM_SERVICE_FEE')).toBe(1_500_000n);
    expect(amount('PLATFORM_COMMISSION')).toBe(750_000n);
    expect(amount('VAT_PAYABLE')).toBe(112_500n);
    expect(amount('AGENT_RENT_PAYABLE')).toBe(14_250_000n);
    expect(amount('AGENT_CLEANING_PAYABLE')).toBe(1_000_000n);
    expect(amount('CAUTION_HELD')).toBe(2_000_000n);
    expect(bySource.get(`payment:${p.id}`)).toBe(p.amountKobo);

    const earning = await ctx.prisma.agentEarning.findUniqueOrThrow({
      where: { bookingId: booking.id },
    });
    expect(earning).toMatchObject({
      status: 'PENDING',
      amountKobo: 15_250_000n,
      agentProfileId: agent.agentProfileId,
    });

    const detail = (await ctx.http().get(`/api/v1/bookings/${booking.id}`).set(c.auth).expect(200))
      .body.data;
    expect(detail).toMatchObject({
      status: 'CONFIRMED',
      paymentStatus: 'SUCCESS',
      canPay: false,
      canCancel: true,
    });
    expect(detail.cancellationRefundKobo).toBe(19_612_500);
  });

  it('shares customer contact details with the agent only after payment', async () => {
    const { customer: c, booking, agent } = await unpaidBooking();
    await payWithTestProvider(ctx, c, booking.id);
    const detail = (
      await ctx.http().get(`/api/v1/agents/me/bookings/${booking.id}`).set(agent.auth).expect(200)
    ).body.data;
    expect(detail.customer.email).toBe(c.email);
    expect(detail.financials).toMatchObject({
      stayKobo: 15_000_000,
      cleaningKobo: 1_000_000,
      commissionKobo: 750_000,
      payoutKobo: 15_250_000,
      cautionKobo: 2_000_000,
      earningStatus: 'PENDING',
    });
    const earnings = (
      await ctx.http().get('/api/v1/agents/me/earnings').set(agent.auth).expect(200)
    ).body.data;
    expect(earnings).toEqual({
      paidBookings: 1,
      grossKobo: 16_000_000,
      commissionKobo: 750_000,
      pendingKobo: 15_250_000,
      availableKobo: 0,
      reversedKobo: 0,
      vatKobo: 112_500,
      withdrawalsAvailable: false,
    });
  });
});

describe('failed and retried payments', () => {
  it('a declined payment leaves the booking unpaid; a retry can then succeed', async () => {
    const { customer: c, booking } = await unpaidBooking();
    const failed = await payWithTestProvider(ctx, c, booking.id, 'failed');
    expect(failed.verification).toMatchObject({
      paymentStatus: 'FAILED',
      bookingStatus: 'AWAITING_PAYMENT',
    });
    expect(await ctx.prisma.ledgerEntry.count()).toBe(0);
    expect(await ctx.prisma.agentEarning.count()).toBe(0);

    const retry = await payWithTestProvider(ctx, c, booking.id);
    expect(retry.verification).toMatchObject({
      paymentStatus: 'SUCCESS',
      bookingStatus: 'CONFIRMED',
    });
    const detail = (await ctx.http().get(`/api/v1/bookings/${booking.id}`).set(c.auth).expect(200))
      .body.data;
    expect(detail.payments.map((p: { status: string }) => p.status)).toEqual(['FAILED', 'SUCCESS']);
    expect(detail.paymentStatus).toBe('SUCCESS');
  });

  it('a browser redirect alone proves nothing: unpaid stays PENDING', async () => {
    const { customer: c, booking } = await unpaidBooking();
    const payment = await startPayment(ctx, c, booking.id);
    const res = await verify(c, payment.reference).expect(200);
    expect(res.body.data).toMatchObject({
      paymentStatus: 'PENDING',
      bookingStatus: 'AWAITING_PAYMENT',
    });
  });

  it.each([
    ['amount', { amountKobo: '100' }],
    ['currency', { currency: 'USD' }],
    ['reference', { reference: 'HHP-000000000000000000000000' }],
  ])('rejects a provider "success" with the wrong %s', async (field, report) => {
    const { customer: c, booking } = await unpaidBooking();
    const payment = await startPayment(ctx, c, booking.id);
    await testProvider(ctx).simulate(payment.reference, 'success', report);
    const res = await verify(c, payment.reference).expect(200);
    expect(res.body.data).toMatchObject({
      paymentStatus: 'FAILED',
      bookingStatus: 'AWAITING_PAYMENT',
    });
    const p = await paymentRow(payment.reference);
    expect(p.failureReason).toContain(`Verification mismatch: ${field}`);
    expect(await ctx.prisma.ledgerEntry.count()).toBe(0);
    expect(await ctx.prisma.agentEarning.count()).toBe(0);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'payment.verification_mismatch' } }),
    ).toBe(1);
  });

  it('a verification outage leaves the payment pending for a later retry', async () => {
    const { customer: c, booking } = await unpaidBooking();
    const payment = await startPayment(ctx, c, booking.id);
    await testProvider(ctx).simulate(payment.reference, 'success');
    // The provider "forgets" the transaction: verification cannot complete.
    const redis = ctx.app.get(RedisService).client;
    const saved = await redis.get(`testpay:${payment.reference}`);
    await redis.del(`testpay:${payment.reference}`);
    const res = await verify(c, payment.reference).expect(502);
    expect(res.body.code).toBe('PAYMENT_VERIFICATION_FAILED');
    expect((await paymentRow(payment.reference)).status).toBe('PENDING');
    // Provider back: the same payment settles normally.
    await redis.set(`testpay:${payment.reference}`, saved!);
    expect((await verify(c, payment.reference).expect(200)).body.data.bookingStatus).toBe(
      'CONFIRMED',
    );
  });

  it('customers cannot verify or open other customers’ payments', async () => {
    const { customer: c, booking } = await unpaidBooking();
    const payment = await startPayment(ctx, c, booking.id);
    const other = await customer(ctx);
    await verify(other, payment.reference).expect(404);
    await ctx
      .http()
      .get(`/api/v1/payments/test-checkout/${payment.reference}`)
      .set(other.auth)
      .expect(404);
    await ctx
      .http()
      .post(`/api/v1/payments/test-checkout/${payment.reference}`)
      .set(other.auth)
      .send({ outcome: 'success' })
      .expect(404);
    expect((await paymentRow(payment.reference)).status).toBe('PENDING');
  });
});

describe('idempotency', () => {
  it('repeated and concurrent callbacks settle once', async () => {
    const { customer: c, booking } = await unpaidBooking();
    const payment = await startPayment(ctx, c, booking.id);
    await testProvider(ctx).simulate(payment.reference, 'success');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => verify(c, payment.reference)),
    );
    for (const r of results) expect(r.body.data.bookingStatus).toBe('CONFIRMED');
    await verify(c, payment.reference).expect(200);

    expect(await ctx.prisma.ledgerEntry.count({ where: { bookingId: booking.id } })).toBe(6);
    expect(await ctx.prisma.agentEarning.count({ where: { bookingId: booking.id } })).toBe(1);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'booking.confirmed', resourceId: booking.id },
      }),
    ).toBe(1);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'payment.succeeded' } })).toBe(1);
  });

  it('duplicate signed webhooks settle once, alongside the redirect', async () => {
    const { customer: c, booking } = await unpaidBooking();
    const payment = await startPayment(ctx, c, booking.id);
    await testProvider(ctx).simulate(payment.reference, 'success');
    const event = {
      event: 'charge.success',
      data: { reference: payment.reference, amount: 1, status: 'success' },
    };
    const responses = await Promise.all([
      paystackWebhook(ctx, event),
      paystackWebhook(ctx, event),
      verify(c, payment.reference),
      paystackWebhook(ctx, event),
    ]);
    for (const r of responses) expect(r.status).toBe(200);
    expect((await bookingRow(booking.id)).status).toBe('CONFIRMED');
    const { bySource } = await ledgerTotals(ctx, booking.id);
    expect([...bySource.values()]).toEqual([19_612_500n]);
    expect(await ctx.prisma.agentEarning.count()).toBe(1);
  });

  it('webhook contents are never trusted: the amount in the event is ignored', async () => {
    const { customer: c, booking } = await unpaidBooking();
    const payment = await startPayment(ctx, c, booking.id);
    // Provider says it is still pending; a forged-looking (validly signed) event claims success.
    await paystackWebhook(ctx, {
      event: 'charge.success',
      data: { reference: payment.reference, amount: 19_612_500 },
    }).expect(200);
    expect((await paymentRow(payment.reference)).status).toBe('PENDING');
    expect((await bookingRow(booking.id)).status).toBe('AWAITING_PAYMENT');
  });

  it('rejects webhooks with a bad signature and acknowledges unknown references', async () => {
    const { customer: c, booking } = await unpaidBooking();
    const payment = await startPayment(ctx, c, booking.id);
    await testProvider(ctx).simulate(payment.reference, 'success');
    const event = { event: 'charge.success', data: { reference: payment.reference } };
    await paystackWebhook(ctx, event, 'sk_test_wrong_secret').expect(401);
    await ctx.http().post('/api/v1/payments/webhooks/paystack').send(event).expect(401);
    expect((await paymentRow(payment.reference)).status).toBe('PENDING');
    await paystackWebhook(ctx, {
      event: 'charge.success',
      data: { reference: 'HHP-unknown' },
    }).expect(200);
    await paystackWebhook(ctx, { event: 'subscription.create', data: {} }).expect(200);
  });

  it('a booking cannot be confirmed twice: a second successful payment is owed back', async () => {
    const { customer: c, booking } = await unpaidBooking();
    const first = await startPayment(ctx, c, booking.id);
    const second = await startPayment(ctx, c, booking.id);
    await testProvider(ctx).simulate(first.reference, 'success');
    await testProvider(ctx).simulate(second.reference, 'success');
    await verify(c, first.reference).expect(200);
    await verify(c, second.reference).expect(200);

    expect(await ctx.prisma.auditLog.count({ where: { action: 'booking.confirmed' } })).toBe(1);
    expect(await ctx.prisma.agentEarning.count()).toBe(1);
    const secondRow = await paymentRow(second.reference);
    expect(secondRow.status).toBe('SUCCESS');
    const { entries, bySource } = await ledgerTotals(ctx, booking.id);
    expect(entries.filter((e) => e.paymentId === secondRow.id).map((e) => e.type)).toEqual([
      'UNALLOCATED',
    ]);
    expect(bySource.get(`payment:${secondRow.id}`)).toBe(secondRow.amountKobo);
    const refund = await ctx.prisma.refund.findUniqueOrThrow({
      where: { paymentId: secondRow.id },
    });
    expect(refund).toMatchObject({
      status: 'REQUESTED',
      requestedBy: 'SYSTEM',
      amountKobo: secondRow.amountKobo,
    });
    expect(refund.reason).toMatch(/Duplicate payment/);
  });

  it('a payment that lands after the booking expired is refunded, never confirmed', async () => {
    const { customer: c, booking } = await unpaidBooking();
    const payment = await startPayment(ctx, c, booking.id);
    await ctx.prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'EXPIRED', expiredAt: new Date() },
    });
    await testProvider(ctx).simulate(payment.reference, 'success');
    const res = await verify(c, payment.reference).expect(200);
    expect(res.body.data).toMatchObject({ paymentStatus: 'SUCCESS', bookingStatus: 'EXPIRED' });
    expect(await ctx.prisma.agentEarning.count()).toBe(0);
    const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(refund.reason).toMatch(/after the booking was expired/);
  });

  it('ledger entries are append-only at the database level', async () => {
    const { customer: c, booking } = await unpaidBooking();
    await payWithTestProvider(ctx, c, booking.id);
    await expect(
      ctx.prisma.$executeRawUnsafe('UPDATE ledger_entries SET amount_kobo = 1'),
    ).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.$executeRawUnsafe('DELETE FROM ledger_entries')).rejects.toThrow(
      /append-only/,
    );
  });
});

describe('cancellation and refunds', () => {
  async function paidBooking() {
    const setup = await unpaidBooking();
    const { payment } = await payWithTestProvider(ctx, setup.customer, setup.booking.id);
    return { ...setup, payment: await paymentRow(payment.reference) };
  }

  it('cancelling a paid booking opens a full refund; approval reverses the ledger exactly once', async () => {
    const { customer: c, booking, payment, agent } = await paidBooking();
    const cancelled = (
      await ctx
        .http()
        .post(`/api/v1/bookings/${booking.id}/cancel`)
        .set(c.auth)
        .send({ reason: 'Trip cancelled' })
        .expect(200)
    ).body.data;
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      refund: { status: 'REQUESTED', amountKobo: 19_612_500, requestedBy: 'CUSTOMER' },
    });

    const finance = await adminAuth(ctx, ['finance_admin']);
    const queue = (
      await ctx.http().get('/api/v1/admin/refunds?status=REQUESTED').set(finance.auth).expect(200)
    ).body.data;
    expect(queue.items).toHaveLength(1);
    const refundId = queue.items[0].id;

    const approved = (
      await ctx
        .http()
        .post(`/api/v1/admin/refunds/${refundId}/review`)
        .set(finance.auth)
        .send({ action: 'APPROVE' })
        .expect(200)
    ).body.data;
    expect(approved.status).toBe('COMPLETED');

    const { bySource } = await ledgerTotals(ctx, booking.id);
    expect(bySource.get(`payment:${payment.id}`)).toBe(19_612_500n);
    expect(bySource.get(`refund:${refundId}`)).toBe(-19_612_500n);
    expect((await paymentRow(payment.reference)).status).toBe('REFUNDED');
    expect(
      (await ctx.prisma.agentEarning.findUniqueOrThrow({ where: { bookingId: booking.id } }))
        .status,
    ).toBe('REVERSED');

    // Approving again, completing again, or a provider webhook replay change nothing.
    await ctx
      .http()
      .post(`/api/v1/admin/refunds/${refundId}/review`)
      .set(finance.auth)
      .send({ action: 'APPROVE' })
      .expect(409);
    await ctx.app.get(RefundsService).complete(refundId, null);
    await paystackWebhook(ctx, {
      event: 'refund.processed',
      data: { transaction_reference: payment.reference },
    }).expect(200);
    expect(await ctx.prisma.ledgerEntry.count({ where: { refundId } })).toBe(6);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'refund.completed' } })).toBe(1);

    const earnings = (
      await ctx.http().get('/api/v1/agents/me/earnings').set(agent.auth).expect(200)
    ).body.data;
    expect(earnings).toMatchObject({ pendingKobo: 0, availableKobo: 0, reversedKobo: 15_250_000 });
    const detail = (await ctx.http().get(`/api/v1/bookings/${booking.id}`).set(c.auth).expect(200))
      .body.data;
    expect(detail).toMatchObject({ paymentStatus: 'REFUNDED', refund: { status: 'COMPLETED' } });
  });

  it('a payment can only ever have one refund', async () => {
    const { customer: c, booking, payment } = await paidBooking();
    await ctx.http().post(`/api/v1/bookings/${booking.id}/cancel`).set(c.auth).send({}).expect(200);
    await expect(
      ctx.prisma.refund.create({
        data: {
          bookingId: booking.id,
          paymentId: payment.id,
          amountKobo: 1n,
          reason: 'again',
          requestedBy: 'ADMIN',
        },
      }),
    ).rejects.toThrow();
    expect(await ctx.prisma.refund.count()).toBe(1);
  });

  it('rejection needs a reason and leaves the money untouched', async () => {
    const { customer: c, booking } = await paidBooking();
    await ctx.http().post(`/api/v1/bookings/${booking.id}/cancel`).set(c.auth).send({}).expect(200);
    const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { bookingId: booking.id } });
    const finance = await adminAuth(ctx, ['finance_admin']);
    await ctx
      .http()
      .post(`/api/v1/admin/refunds/${refund.id}/review`)
      .set(finance.auth)
      .send({ action: 'REJECT' })
      .expect(422);
    await ctx
      .http()
      .post(`/api/v1/admin/refunds/${refund.id}/review`)
      .set(finance.auth)
      .send({ action: 'REJECT', note: 'Fraud review' })
      .expect(200);
    expect(await ctx.prisma.ledgerEntry.count({ where: { refundId: refund.id } })).toBe(0);
    await ctx
      .http()
      .post(`/api/v1/admin/refunds/${refund.id}/review`)
      .set(finance.auth)
      .send({ action: 'APPROVE' })
      .expect(409);
  });

  it('only payments.refund may approve refunds', async () => {
    const { customer: c, booking } = await paidBooking();
    await ctx.http().post(`/api/v1/bookings/${booking.id}/cancel`).set(c.auth).send({}).expect(200);
    const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { bookingId: booking.id } });
    const support = await adminAuth(ctx, ['support_admin']);
    await ctx
      .http()
      .post(`/api/v1/admin/refunds/${refund.id}/review`)
      .set(support.auth)
      .send({ action: 'APPROVE' })
      .expect(403);
    await ctx
      .http()
      .post(`/api/v1/admin/refunds/${refund.id}/review`)
      .set(c.auth)
      .send({ action: 'APPROVE' })
      .expect(403);
    expect((await ctx.prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe(
      'REQUESTED',
    );
  });

  it('once the stay has started only an admin can cancel', async () => {
    const { customer: c, booking, agent } = await paidBooking();
    await ctx.prisma.booking.update({
      where: { id: booking.id },
      data: {
        startDate: new Date(`${inDays(0)}T00:00:00Z`),
        endDate: new Date(`${inDays(3)}T00:00:00Z`),
      },
    });
    const res = await ctx
      .http()
      .post(`/api/v1/bookings/${booking.id}/cancel`)
      .set(c.auth)
      .send({})
      .expect(409);
    expect(res.body.message).toMatch(/already started/);
    await ctx
      .http()
      .post(`/api/v1/agents/me/bookings/${booking.id}/cancel`)
      .set(agent.auth)
      .send({})
      .expect(409);
    const finance = await adminAuth(ctx, ['finance_admin']);
    const admin = (
      await ctx
        .http()
        .post(`/api/v1/admin/bookings/${booking.id}/cancel`)
        .set(finance.auth)
        .send({ reason: 'Property unsafe' })
        .expect(200)
    ).body.data;
    expect(admin).toMatchObject({ status: 'CANCELLED', cancellation: { cancelledBy: 'ADMIN' } });
    expect(admin.refunds[0]).toMatchObject({ status: 'REQUESTED', requestedBy: 'ADMIN' });
  });

  it('every financial state change is audited', async () => {
    const { customer: c, booking } = await paidBooking();
    await ctx.http().post(`/api/v1/bookings/${booking.id}/cancel`).set(c.auth).send({}).expect(200);
    const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { bookingId: booking.id } });
    const finance = await adminAuth(ctx, ['finance_admin']);
    await ctx
      .http()
      .post(`/api/v1/admin/refunds/${refund.id}/review`)
      .set(finance.auth)
      .send({ action: 'APPROVE' })
      .expect(200);
    const actions = (await ctx.prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map(
      (a) => a.action,
    );
    for (const action of [
      'booking.created',
      'payment.initiated',
      'payment.succeeded',
      'booking.confirmed',
      'booking.cancelled',
      'refund.requested',
      'refund.approved',
      'refund.completed',
    ]) {
      expect(actions).toContain(action);
    }
  });
});

describe('admin finance views', () => {
  it('lists payments and refunds with their bookings', async () => {
    const { customer: c, booking } = await unpaidBooking();
    await payWithTestProvider(ctx, c, booking.id, 'failed');
    await payWithTestProvider(ctx, c, booking.id);
    const finance = await adminAuth(ctx, ['finance_admin']);
    const payments = (await ctx.http().get('/api/v1/admin/payments').set(finance.auth).expect(200))
      .body.data;
    expect(payments.total).toBe(2);
    expect(payments.items[0]).toMatchObject({
      status: 'SUCCESS',
      booking: { reference: booking.reference, status: 'CONFIRMED' },
      customer: { email: c.email },
    });
    const failed = (
      await ctx.http().get('/api/v1/admin/payments?status=FAILED').set(finance.auth).expect(200)
    ).body.data;
    expect(failed.items).toHaveLength(1);
  });
});
