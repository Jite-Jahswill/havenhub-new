import { createHmac } from 'node:crypto';

import {
  addDays,
  todayInNigeria,
  type CustomerBookingDetail,
  type PaymentInitView,
  type PricingConfigInput,
} from '@havenhub/shared';
import { expect } from 'vitest';

import { TestPaymentProvider } from '../../src/modules/finance/providers/test-payment.provider';
import { QA_PRICING_RATES } from '../fixtures/qa-pricing-rates';
import {
  bearer,
  createAdmin,
  createAgent,
  createPublished,
  loginToken,
  registerCustomer,
  type Agent,
  type TestContext,
} from './test-app';

export async function adminAuth(ctx: TestContext, roles: string[]) {
  const admin = await createAdmin(ctx, roles);
  const { tokens } = await loginToken(ctx, admin);
  return { ...admin, auth: bearer(tokens.accessToken) };
}

export async function setPricing(ctx: TestContext, rates: Partial<PricingConfigInput> = {}) {
  const finance = await adminAuth(ctx, ['finance_admin']);
  await ctx
    .http()
    .post('/api/v1/admin/finance/pricing')
    .set(finance.auth)
    .send({ ...QA_PRICING_RATES, ...rates })
    .expect(201);
  return finance;
}

export async function customer(ctx: TestContext) {
  const creds = await registerCustomer(ctx);
  const { user, tokens } = await loginToken(ctx, creds);
  return { id: user.id, email: creds.email, auth: bearer(tokens.accessToken) };
}
export type Customer = Awaited<ReturnType<typeof customer>>;

/** ₦50,000 a night, sleeps 4. */
export const DAILY = {
  pricingPeriod: 'DAILY',
  priceKobo: 5_000_000,
  maxGuests: 4,
  cleaningOption: 'NOT_AVAILABLE',
};

export async function rental(
  ctx: TestContext,
  overrides: Record<string, unknown> = DAILY,
  agent?: Agent,
) {
  const owner = agent ?? (await createAgent(ctx));
  const property = await createPublished(ctx, owner, overrides);
  return { agent: owner, property };
}

export const inDays = (days: number) => addDays(todayInNigeria(), days);

export async function book(
  ctx: TestContext,
  who: Customer,
  body: Record<string, unknown>,
  expected = 201,
) {
  const res = await ctx.http().post('/api/v1/bookings').set(who.auth).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(expected);
  return res.body.data as CustomerBookingDetail;
}

export async function startPayment(ctx: TestContext, who: Customer, bookingId: string) {
  const res = await ctx.http().post(`/api/v1/bookings/${bookingId}/payments`).set(who.auth);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as PaymentInitView;
}

export const testProvider = (ctx: TestContext) => ctx.app.get(TestPaymentProvider);

/** Customer "pays" on the simulated checkout, then the server verifies it. */
export async function payWithTestProvider(
  ctx: TestContext,
  who: Customer,
  bookingId: string,
  outcome: 'success' | 'failed' = 'success',
) {
  const payment = await startPayment(ctx, who, bookingId);
  const res = await ctx
    .http()
    .post(`/api/v1/payments/test-checkout/${payment.reference}`)
    .set(who.auth)
    .send({ outcome });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return {
    payment,
    verification: res.body.data as { paymentStatus: string; bookingStatus: string },
  };
}

/** A Paystack-signed webhook, signed with the test secret from the test env. */
export function paystackWebhook(
  ctx: TestContext,
  payload: unknown,
  secret = ctx.env.PAYSTACK_SECRET_KEY!,
) {
  const body = JSON.stringify(payload);
  const signature = createHmac('sha512', secret).update(body).digest('hex');
  return ctx
    .http()
    .post('/api/v1/payments/webhooks/paystack')
    .set('Content-Type', 'application/json')
    .set('x-paystack-signature', signature)
    .send(body);
}

/** Σ ledger amounts per source (payment:/refund:) for a booking. */
export async function ledgerTotals(ctx: TestContext, bookingId: string) {
  const entries = await ctx.prisma.ledgerEntry.findMany({ where: { bookingId } });
  const bySource = new Map<string, bigint>();
  for (const e of entries)
    bySource.set(e.sourceKey, (bySource.get(e.sourceKey) ?? 0n) + e.amountKobo);
  return { entries, bySource };
}
