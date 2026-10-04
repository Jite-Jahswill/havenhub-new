import { PaymentProviderName } from '@havenhub/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PaymentProviders } from '../src/modules/finance/providers/payment-providers.service';
import { PaystackProvider } from '../src/modules/finance/providers/paystack.provider';
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
afterEach(() => vi.restoreAllMocks());
afterAll(() => ctx.close());

/** Paystack's id of the transaction being refunded in these tests. */
const TRANSACTION_ID = 987654;

/**
 * A stand-in for Paystack's refund API (GET /refund, POST /refund) behind
 * the real PaystackProvider, so the provider's parsing and the refund
 * service run exactly as in production.
 */
function fakePaystack() {
  const state: { listed: unknown; sent: number; nextId: number } = {
    listed: [],
    sent: 0,
    nextId: 1000,
  };
  const json = (data: unknown) =>
    new Response(JSON.stringify({ status: true, message: 'ok', data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === '/refund' && init?.method === 'GET') return Promise.resolve(json(state.listed));
    if (path === '/refund' && init?.method === 'POST') {
      state.sent++;
      const body = JSON.parse(init.body as string) as { transaction: string };
      const refund = {
        id: state.nextId++,
        status: 'processed',
        transaction: TRANSACTION_ID,
        transaction_reference: body.transaction,
      };
      if (Array.isArray(state.listed)) state.listed.push(refund);
      return Promise.resolve(json({ id: refund.id, status: refund.status }));
    }
    return Promise.reject(new Error(`unexpected Paystack call ${path}`));
  });
  const provider = new PaystackProvider(
    'sk_test_unit',
    'https://paystack.test',
    fetchImpl as unknown as typeof fetch,
  );
  return { state, provider };
}

/** A paid, cancelled booking whose payment is (as far as refunds go) a Paystack payment. */
async function requestedRefund() {
  const { property } = await rental(ctx);
  const who = await customer(ctx);
  const booking = await book(ctx, who, {
    propertyId: property.id,
    startDate: inDays(10),
    quantity: 2,
  });
  const { payment } = await payWithTestProvider(ctx, who, booking.id);
  await ctx.prisma.payment.update({
    where: { reference: payment.reference },
    data: { providerTransactionId: String(TRANSACTION_ID) },
  });
  await ctx.http().post(`/api/v1/bookings/${booking.id}/cancel`).set(who.auth).send({}).expect(200);
  const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { bookingId: booking.id } });
  const finance = await adminAuth(ctx, ['finance_admin']);

  const paystack = fakePaystack();
  const providers = ctx.app.get(PaymentProviders);
  const original = providers.get.bind(providers);
  vi.spyOn(providers, 'get').mockImplementation((name) =>
    name === PaymentProviderName.TEST ? paystack.provider : original(name),
  );
  return {
    booking,
    reference: payment.reference,
    refundId: refund.id,
    finance: finance.auth,
    paystack: paystack.state,
  };
}

type Setup = Awaited<ReturnType<typeof requestedRefund>>;

const review = (s: Setup, action: 'APPROVE' | 'RECHECK') =>
  ctx.http().post(`/api/v1/admin/refunds/${s.refundId}/review`).set(s.finance).send({ action });
const refundRow = (s: Setup) => ctx.prisma.refund.findUniqueOrThrow({ where: { id: s.refundId } });
const reversals = async (s: Setup) =>
  (await ledgerTotals(ctx, s.booking.id)).entries.filter((e) => e.refundId === s.refundId).length;
const audits = (s: Setup, action: string) =>
  ctx.prisma.auditLog.count({ where: { resourceId: s.refundId, action } });

/** A processed refund of a different Paystack transaction. */
const foreign = (id: number, status = 'processed') => ({
  id,
  status,
  transaction: 111111,
  transaction_reference: 'HHP-SOMEONE-ELSE',
});
const ours = (s: Setup, id: number, status: string) => ({
  id,
  status,
  transaction: TRANSACTION_ID,
  transaction_reference: s.reference,
});

describe('refund ownership (the provider list filter is not trusted)', () => {
  it('A: adopts an existing refund of this transaction without sending another', async () => {
    const s = await requestedRefund();
    s.paystack.listed = [ours(s, 501, 'processed')];
    expect((await review(s, 'APPROVE').expect(200)).body.data.status).toBe('COMPLETED');
    expect(await refundRow(s)).toMatchObject({ providerRefundId: '501' });
    expect(s.paystack.sent).toBe(0);
    expect(await reversals(s)).toBeGreaterThan(0);
  });

  it('B: skips another transaction listed first and adopts this one', async () => {
    const s = await requestedRefund();
    s.paystack.listed = [foreign(601), ours(s, 602, 'processed')];
    expect((await review(s, 'APPROVE').expect(200)).body.data.status).toBe('COMPLETED');
    expect((await refundRow(s)).providerRefundId).toBe('602');
    expect(s.paystack.sent).toBe(0);
  });

  it("C: never adopts another transaction's refund; sends this payment's own", async () => {
    const s = await requestedRefund();
    s.paystack.listed = [foreign(701), foreign(702, 'pending')];
    expect((await review(s, 'APPROVE').expect(200)).body.data.status).toBe('COMPLETED');
    const row = await refundRow(s);
    expect(row.providerRefundId).toBe('1000'); // the refund just sent, not 701 or 702
    expect(s.paystack.sent).toBe(1);
    expect(await audits(s, 'refund.completed')).toBe(1);
  });

  it('D: an unattributable listing leaves the refund processing and sends nothing', async () => {
    const s = await requestedRefund();
    s.paystack.listed = [{ id: 801, status: 'processed' }]; // names no transaction
    expect((await review(s, 'APPROVE').expect(200)).body.data.status).toBe('PROCESSING');
    expect(await refundRow(s)).toMatchObject({ status: 'PROCESSING', providerRefundId: null });
    expect(await audits(s, 'refund.outcome_unknown')).toBe(1);
    expect(s.paystack.sent).toBe(0);
    expect(await reversals(s)).toBe(0);

    s.paystack.listed = { not: 'a list' };
    expect((await review(s, 'RECHECK').expect(200)).body.data.status).toBe('PROCESSING');
    expect(s.paystack.sent).toBe(0);
    expect(await reversals(s)).toBe(0);

    // Once Paystack answers readably, the re-check proceeds as usual.
    s.paystack.listed = [foreign(802)];
    expect((await review(s, 'RECHECK').expect(200)).body.data.status).toBe('COMPLETED');
    expect(s.paystack.sent).toBe(1);
    expect((await refundRow(s)).providerRefundId).not.toBe('802');
  });

  it('E: repeated re-checks and webhooks keep the same refund and reverse once', async () => {
    const s = await requestedRefund();
    s.paystack.listed = [foreign(901), ours(s, 902, 'pending')];
    expect((await review(s, 'APPROVE').expect(200)).body.data.status).toBe('PROCESSING');
    for (let i = 0; i < 3; i++) {
      expect((await review(s, 'RECHECK').expect(200)).body.data.status).toBe('PROCESSING');
      expect(await refundRow(s)).toMatchObject({ providerRefundId: '902' });
    }
    expect(await reversals(s)).toBe(0);

    s.paystack.listed = [foreign(901), ours(s, 902, 'processed')];
    expect((await review(s, 'RECHECK').expect(200)).body.data.status).toBe('COMPLETED');
    const reversed = await reversals(s);
    expect(reversed).toBeGreaterThan(0);

    await review(s, 'RECHECK').expect(409);
    await paystackWebhook(ctx, {
      event: 'refund.processed',
      data: { transaction_reference: s.reference },
    }).expect(200);
    expect(await refundRow(s)).toMatchObject({ status: 'COMPLETED', providerRefundId: '902' });
    expect(await reversals(s)).toBe(reversed);
    expect(await audits(s, 'refund.completed')).toBe(1);
    expect(s.paystack.sent).toBe(0);
  });
});
