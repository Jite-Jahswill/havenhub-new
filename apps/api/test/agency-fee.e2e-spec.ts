import type { BookingQuote, PricingConfigView } from '@havenhub/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { QA_PRICING_RATES } from './fixtures/qa-pricing-rates';
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
import { createTestContext, type TestContext } from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

/** ₦3,000,000 a year. */
const YEARLY = { pricingPeriod: 'YEARLY', priceKobo: 300_000_000, cleaningOption: 'NOT_AVAILABLE' };

const quote = (body: Record<string, unknown>) =>
  ctx.http().post('/api/v1/bookings/quote').send(body).expect(200);

describe('agency fee', () => {
  it('is charged on listed rental periods and paid in full to the agent', async () => {
    await setPricing(ctx, { agencyFeeBps: 1000, agencyFeePeriods: ['MONTHLY', 'YEARLY'] });
    const { agent, property } = await rental(ctx, YEARLY);
    const stay = { propertyId: property.id, startDate: inDays(30), quantity: 1 };

    const q = (await quote(stay)).body.data as BookingQuote;
    const fee = q.lines.find((l) => l.kind === 'AGENCY_FEE');
    expect(fee).toMatchObject({ label: 'Agency fee (10%)', amountKobo: 30_000_000 });
    // Rent + 10% service fee + VAT on the service fee + agency fee.
    expect(q.totalKobo).toBe(300_000_000 + 30_000_000 + 2_250_000 + 30_000_000);

    const c = await customer(ctx);
    const b = await book(ctx, c, { ...stay, expectedTotalKobo: q.totalKobo });
    const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(row).toMatchObject({ agencyFeeKobo: 30_000_000n, totalKobo: BigInt(q.totalKobo) });
    // Commission is only on the rent; the agency fee goes to the agent untouched.
    expect(row.agentCommissionKobo).toBe(15_000_000n);
    expect(row.agentPayoutKobo).toBe(300_000_000n - 15_000_000n + 30_000_000n);

    await payWithTestProvider(ctx, c, b.id);
    const payment = await ctx.prisma.payment.findFirstOrThrow({
      where: { bookingId: b.id, status: 'SUCCESS' },
    });
    const entries = await ctx.prisma.ledgerEntry.findMany({
      where: { sourceKey: `payment:${payment.id}` },
    });
    expect(entries.find((e) => e.type === 'AGENT_AGENCY_FEE_PAYABLE')!.amountKobo).toBe(
      30_000_000n,
    );
    const { bySource } = await ledgerTotals(ctx, b.id);
    expect(bySource.get(`payment:${payment.id}`)).toBe(BigInt(q.totalKobo));
    const earning = await ctx.prisma.agentEarning.findUniqueOrThrow({ where: { bookingId: b.id } });
    expect(earning.amountKobo).toBe(row.agentPayoutKobo);
    const summary = (await ctx.http().get('/api/v1/agents/me/earnings').set(agent.auth).expect(200))
      .body.data;
    // Gross includes the fee; commission is on the rent only.
    expect(summary).toMatchObject({
      agencyFeeKobo: 30_000_000,
      grossKobo: 300_000_000 + 30_000_000,
      commissionKobo: 15_000_000,
    });

    // A refund reverses the agency fee with everything else.
    await ctx
      .http()
      .post(`/api/v1/agents/me/bookings/${b.id}/cancel`)
      .set(agent.auth)
      .send({})
      .expect(200);
    const finance = await adminAuth(ctx, ['finance_admin']);
    const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { bookingId: b.id } });
    await ctx
      .http()
      .post(`/api/v1/admin/refunds/${refund.id}/review`)
      .set(finance.auth)
      .send({ action: 'APPROVE' })
      .expect(200);
    const after = await ledgerTotals(ctx, b.id);
    expect(after.bySource.get(`refund:${refund.id}`)).toBe(-BigInt(q.totalKobo));
    const reversedFee = await ctx.prisma.ledgerEntry.findFirstOrThrow({
      where: { refundId: refund.id, type: 'AGENT_AGENCY_FEE_PAYABLE' },
    });
    expect(reversedFee.amountKobo).toBe(-30_000_000n);
  });

  it('is not charged on periods that are not listed, or when the rate is 0', async () => {
    await setPricing(ctx, { agencyFeeBps: 1000, agencyFeePeriods: ['YEARLY'] });
    const { property } = await rental(ctx); // nightly
    const nightly = (await quote({ propertyId: property.id, startDate: inDays(10), quantity: 2 }))
      .body.data as BookingQuote;
    expect(nightly.lines.some((l) => l.kind === 'AGENCY_FEE')).toBe(false);

    await setPricing(ctx, { agencyFeeBps: 0, agencyFeePeriods: ['YEARLY'] });
    const yearly = await rental(ctx, YEARLY);
    const q = (await quote({ propertyId: yearly.property.id, startDate: inDays(30), quantity: 1 }))
      .body.data as BookingQuote;
    expect(q.lines.some((l) => l.kind === 'AGENCY_FEE')).toBe(false);
  });

  it('is part of the versioned, audited pricing settings and validated', async () => {
    const finance = await adminAuth(ctx, ['finance_admin']);
    const post = (body: Record<string, unknown>) =>
      ctx
        .http()
        .post('/api/v1/admin/finance/pricing')
        .set(finance.auth)
        .send({ ...QA_PRICING_RATES, ...body });
    await post({ agencyFeeBps: 5001 }).expect(422);
    await post({ agencyFeePeriods: ['SALE'] }).expect(422);
    const res = await post({ agencyFeeBps: 1000, agencyFeePeriods: ['YEARLY', 'YEARLY'] }).expect(
      201,
    );
    expect(res.body.data as PricingConfigView).toMatchObject({
      agencyFeeBps: 1000,
      agencyFeePeriods: ['YEARLY'],
    });
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'finance.pricing_config.created' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.after).toMatchObject({ agencyFeeBps: 1000, agencyFeePeriods: ['YEARLY'] });

    // Older settings without the fields still mean "no agency fee".
    await post({}).expect(201);
    const latest = await ctx.prisma.pricingConfig.findFirstOrThrow({
      orderBy: { version: 'desc' },
    });
    expect(latest).toMatchObject({ agencyFeeBps: 0, agencyFeePeriods: [] });
  });
});
