import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
  testProvider,
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

/** A paid booking, cancelled by the customer: one REQUESTED full refund. */
async function requestedRefund() {
  const { property } = await rental(ctx);
  const who = await customer(ctx);
  const booking = await book(ctx, who, {
    propertyId: property.id,
    startDate: inDays(10),
    quantity: 2,
  });
  const { payment } = await payWithTestProvider(ctx, who, booking.id);
  await ctx.http().post(`/api/v1/bookings/${booking.id}/cancel`).set(who.auth).send({}).expect(200);
  const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { bookingId: booking.id } });
  const finance = await adminAuth(ctx, ['finance_admin']);
  return { booking, reference: payment.reference, refundId: refund.id, finance: finance.auth };
}

type Setup = Awaited<ReturnType<typeof requestedRefund>>;

const review = (s: Setup, action: 'APPROVE' | 'REJECT' | 'RECHECK', note?: string) =>
  ctx
    .http()
    .post(`/api/v1/admin/refunds/${s.refundId}/review`)
    .set(s.finance)
    .send({ action, ...(note ? { note } : {}) });

const refundRow = (s: Setup) => ctx.prisma.refund.findUniqueOrThrow({ where: { id: s.refundId } });
const requests = (s: Setup) => testProvider(ctx).refundRequests(s.reference);
const reversals = async (s: Setup) =>
  (await ledgerTotals(ctx, s.booking.id)).entries.filter((e) => e.refundId === s.refundId).length;
const audits = (s: Setup, action: string) =>
  ctx.prisma.auditLog.count({ where: { resourceId: s.refundId, action } });

describe('refunds with an unknown provider outcome (A4)', () => {
  it('a successful refund completes with one provider request and one reversal', async () => {
    const s = await requestedRefund();
    expect((await review(s, 'APPROVE').expect(200)).body.data.status).toBe('COMPLETED');
    expect(await requests(s)).toBe(1);
    expect(await reversals(s)).toBeGreaterThan(0);
    const before = await reversals(s);
    // Webhook replays and re-checks change nothing.
    await paystackWebhook(ctx, {
      event: 'refund.processed',
      data: { transaction_reference: s.reference },
    }).expect(200);
    await review(s, 'RECHECK').expect(409);
    expect(await reversals(s)).toBe(before);
    expect(await requests(s)).toBe(1);
  });

  it('a definite refusal fails the refund; approving again retries safely', async () => {
    const s = await requestedRefund();
    await testProvider(ctx).simulateRefund(s.reference, 'reject');
    expect((await review(s, 'APPROVE').expect(200)).body.data.status).toBe('FAILED');
    expect(await refundRow(s)).toMatchObject({
      status: 'FAILED',
      failureReason: 'Refused (simulated)',
    });
    expect(await audits(s, 'refund.failed')).toBe(1);
    expect(await reversals(s)).toBe(0);

    await testProvider(ctx).simulateRefund(s.reference, 'complete');
    expect((await review(s, 'APPROVE').expect(200)).body.data.status).toBe('COMPLETED');
    expect(await requests(s)).toBe(2);
  });

  it('a timeout keeps the refund PROCESSING (never FAILED) and sends nothing more on its own', async () => {
    const s = await requestedRefund();
    await testProvider(ctx).simulateRefund(s.reference, 'unreachable');
    expect((await review(s, 'APPROVE').expect(200)).body.data.status).toBe('PROCESSING');
    expect(await refundRow(s)).toMatchObject({ status: 'PROCESSING', failureReason: null });
    expect(await audits(s, 'refund.outcome_unknown')).toBe(1);
    expect(await reversals(s)).toBe(0);
    // It cannot be approved again; only re-checked.
    await review(s, 'APPROVE').expect(409);
    expect(await requests(s)).toBe(1);
  });

  it('lost answer, provider shows the refund: re-check completes it without a second request', async () => {
    const s = await requestedRefund();
    await testProvider(ctx).simulateRefund(s.reference, 'lost-response');
    expect((await review(s, 'APPROVE').expect(200)).body.data.status).toBe('PROCESSING');
    expect(await requests(s)).toBe(1);

    await testProvider(ctx).simulateRefund(s.reference, 'complete');
    expect((await review(s, 'RECHECK', 'Provider timed out').expect(200)).body.data.status).toBe(
      'COMPLETED',
    );
    expect(await requests(s)).toBe(1);
    expect((await refundRow(s)).providerRefundId).toBe(`test_refund_${s.reference}`);
    const reversed = await reversals(s);
    expect(reversed).toBeGreaterThan(0);
    await paystackWebhook(ctx, {
      event: 'refund.processed',
      data: { transaction_reference: s.reference },
    }).expect(200);
    expect(await reversals(s)).toBe(reversed);
    expect(await audits(s, 'refund.rechecked')).toBe(1);
  });

  it('timeout before reaching the provider: re-check finds none and retries safely', async () => {
    const s = await requestedRefund();
    await testProvider(ctx).simulateRefund(s.reference, 'unreachable');
    await review(s, 'APPROVE').expect(200);
    // Still unreachable for look-ups: nothing is sent, still processing.
    await testProvider(ctx).simulateRefund(s.reference, 'lookup-unreachable');
    expect((await review(s, 'RECHECK').expect(200)).body.data.status).toBe('PROCESSING');
    expect(await requests(s)).toBe(1);

    await testProvider(ctx).simulateRefund(s.reference, 'complete');
    expect((await review(s, 'RECHECK').expect(200)).body.data.status).toBe('COMPLETED');
    expect(await requests(s)).toBe(2);
  });

  it('a refund accepted but still processing is not resent; it completes once confirmed', async () => {
    const s = await requestedRefund();
    await testProvider(ctx).simulateRefund(s.reference, 'processing');
    expect((await review(s, 'APPROVE').expect(200)).body.data.status).toBe('PROCESSING');
    await review(s, 'RECHECK').expect(200);
    expect((await refundRow(s)).status).toBe('PROCESSING');
    expect(await requests(s)).toBe(1);
    await testProvider(ctx).settleSimulatedRefund(s.reference);
    expect((await review(s, 'RECHECK').expect(200)).body.data.status).toBe('COMPLETED');
    expect(await requests(s)).toBe(1);
  });

  it('a retry refused because the money already went back adopts that refund', async () => {
    const s = await requestedRefund();
    await testProvider(ctx).simulateRefund(s.reference, 'reject');
    await review(s, 'APPROVE').expect(200);
    // Meanwhile the refund was made at the provider (e.g. from its dashboard).
    await testProvider(ctx).simulateRefund(s.reference, 'complete');
    await testProvider(ctx).refund({ reference: s.reference });
    expect((await review(s, 'APPROVE').expect(200)).body.data.status).toBe('COMPLETED');
    expect(await requests(s)).toBe(2); // the refused one and the outside one — none sent by the retry
  });

  it('concurrent re-checks cannot send two provider refunds', async () => {
    const s = await requestedRefund();
    await testProvider(ctx).simulateRefund(s.reference, 'unreachable');
    await review(s, 'APPROVE').expect(200);
    await testProvider(ctx).simulateRefund(s.reference, 'complete');
    const results = await Promise.all([
      review(s, 'RECHECK'),
      review(s, 'RECHECK'),
      review(s, 'RECHECK'),
    ]);
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect([200, 409]).toContain(r.status);
    expect((await refundRow(s)).status).toBe('COMPLETED');
    expect(await requests(s)).toBe(2); // the lost first attempt + exactly one retry
    const first = await reversals(s);
    expect(first).toBeGreaterThan(0);
  });

  it('re-check is only for processing refunds and needs payments.refund', async () => {
    const s = await requestedRefund();
    await review(s, 'RECHECK').expect(409);
    const support = await adminAuth(ctx, ['support_admin']);
    await ctx
      .http()
      .post(`/api/v1/admin/refunds/${s.refundId}/review`)
      .set(support.auth)
      .send({ action: 'RECHECK' })
      .expect(403);
    expect((await refundRow(s)).status).toBe('REQUESTED');
    expect(await requests(s)).toBe(0);
  });
});
