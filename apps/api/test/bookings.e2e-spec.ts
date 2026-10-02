import type { BookingQuote } from '@havenhub/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BookingMaintenanceService } from '../src/modules/bookings/booking-maintenance.service';
import { isOverlapViolation } from '../src/modules/bookings/bookings.service';
import {
  DAILY,
  adminAuth,
  book,
  customer,
  inDays,
  payWithTestProvider,
  rental,
  setPricing,
  startPayment,
} from './helpers/booking-helpers';
import {
  createAgent,
  createPublished,
  createTestContext,
  moderatorAuth,
  type TestContext,
} from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(async () => {
  await ctx.reset();
});
afterAll(() => ctx.close());

const quote = (body: Record<string, unknown>) =>
  ctx.http().post('/api/v1/bookings/quote').send(body);

describe('bookings are closed until rates are configured', () => {
  it('quotes and bookings refuse without an admin pricing configuration', async () => {
    const { property } = await rental(ctx);
    const res = await quote({ propertyId: property.id, startDate: inDays(5), quantity: 2 }).expect(
      503,
    );
    expect(res.body.code).toBe('BOOKINGS_NOT_OPEN');
    const c = await customer(ctx);
    const created = await ctx
      .http()
      .post('/api/v1/bookings')
      .set(c.auth)
      .send({ propertyId: property.id, startDate: inDays(5), quantity: 2 })
      .expect(503);
    expect(created.body.code).toBe('BOOKINGS_NOT_OPEN');
  });
});

describe('pricing (server-side, integer kobo)', () => {
  beforeEach(() => setPricing(ctx));

  it('daily: nights × nightly rate + service fee + VAT on the fee', async () => {
    const { property } = await rental(ctx);
    const res = await quote({
      propertyId: property.id,
      startDate: inDays(10),
      quantity: 3,
      guests: 2,
    }).expect(200);
    const q = res.body.data;
    expect(q).toMatchObject({
      pricingPeriod: 'DAILY',
      startDate: inDays(10),
      endDate: inDays(13),
      available: true,
      totalKobo: 16_612_500,
      refundableDepositKobo: 0,
    });
    expect(
      q.lines.map((l: { kind: string; amountKobo: number }) => [l.kind, l.amountKobo]),
    ).toEqual([
      ['RENT', 15_000_000],
      ['SERVICE_FEE', 1_500_000],
      ['VAT', 112_500],
    ]);
    for (const line of q.lines) expect(Number.isInteger(line.amountKobo)).toBe(true);
  });

  it('monthly and yearly stays end on the right calendar day', async () => {
    const { property: monthly } = await rental(ctx, {
      pricingPeriod: 'MONTHLY',
      priceKobo: 35_000_000,
    });
    const m = (
      await quote({ propertyId: monthly.id, startDate: '2027-01-31', quantity: 1 }).expect(200)
    ).body.data;
    expect(m.endDate).toBe('2027-02-28');
    expect(m.lines[0]).toMatchObject({
      kind: 'RENT',
      amountKobo: 35_000_000,
      label: 'Rent (1 month)',
    });

    const { property: yearly } = await rental(ctx, {
      pricingPeriod: 'YEARLY',
      priceKobo: 450_000_000,
    });
    const y = (
      await quote({ propertyId: yearly.id, startDate: '2027-06-01', quantity: 2 }).expect(200)
    ).body.data;
    expect(y.endDate).toBe('2029-06-01');
    expect(y.totalKobo).toBe(900_000_000 + 90_000_000 + 6_750_000);
  });

  it('includes the listing discount, cleaning and the caution deposit', async () => {
    const { property } = await rental(ctx, {
      ...DAILY,
      discountPercent: 10,
      cleaningOption: 'AVAILABLE_FOR_FEE',
      cleaningFeeKobo: 1_000_000,
      cautionFeeKobo: 20_000_000,
    });
    const q = (
      await quote({
        propertyId: property.id,
        startDate: inDays(3),
        quantity: 2,
        addCleaning: true,
      }).expect(200)
    ).body.data as BookingQuote;
    const amount = (kind: string) => q.lines.find((l) => l.kind === kind)?.amountKobo;
    expect(amount('RENT')).toBe(10_000_000);
    expect(amount('LISTING_DISCOUNT')).toBe(-1_000_000);
    expect(amount('CLEANING_FEE')).toBe(1_000_000);
    expect(amount('CAUTION_FEE')).toBe(20_000_000);
    expect(amount('SERVICE_FEE')).toBe(900_000); // 10% of the ₦90,000 stay
    expect(amount('VAT')).toBe(67_500);
    expect(q.refundableDepositKobo).toBe(20_000_000);
    expect(q.totalKobo).toBe(9_000_000 + 1_000_000 + 20_000_000 + 900_000 + 67_500);
  });

  it('refuses cleaning the property does not sell', async () => {
    const { property } = await rental(ctx);
    const res = await quote({
      propertyId: property.id,
      startDate: inDays(3),
      quantity: 2,
      addCleaning: true,
    }).expect(422);
    expect(res.body.details.issues[0].path).toBe('addCleaning');
  });
});

describe('creating bookings', () => {
  beforeEach(() => setPricing(ctx));

  it('a customer books a rental; the booking freezes its price breakdown', async () => {
    const { property, agent } = await rental(ctx);
    const c = await customer(ctx);
    const b = await book(ctx, c, {
      propertyId: property.id,
      startDate: inDays(10),
      quantity: 3,
      guests: 2,
    });
    expect(b).toMatchObject({
      status: 'AWAITING_PAYMENT',
      paymentStatus: null,
      startDate: inDays(10),
      endDate: inDays(13),
      totalKobo: 16_612_500,
      canPay: true,
      canCancel: true,
    });
    expect(b.reference).toMatch(/^HH-[2-9A-HJ-NP-Z]{8}$/);
    const row = await ctx.prisma.booking.findUniqueOrThrow({
      where: { id: b.id },
      include: { lines: true },
    });
    expect(row.customerId).toBe(c.id);
    expect(row.agentProfileId).toBe(agent.agentProfileId);
    expect(row.agentCommissionKobo).toBe(750_000n);
    expect(row.agentPayoutKobo).toBe(14_250_000n);
    expect(row.lines.reduce((s, l) => s + l.amountKobo, 0n)).toBe(row.totalKobo);
    expect(row.holdExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
  });

  it('validates stay length, dates and guests against the property', async () => {
    const { property } = await rental(ctx);
    const c = await customer(ctx);
    const cases: [Record<string, unknown>, string][] = [
      [{ startDate: inDays(5), quantity: 91 }, 'quantity'],
      [{ startDate: inDays(-1), quantity: 2 }, 'startDate'],
      [{ startDate: inDays(800), quantity: 2 }, 'startDate'],
      [{ startDate: inDays(5), quantity: 2, guests: 9 }, 'guests'],
    ];
    for (const [body, path] of cases) {
      const res = await ctx
        .http()
        .post('/api/v1/bookings')
        .set(c.auth)
        .send({ propertyId: property.id, ...body })
        .expect(422);
      expect(res.body.details.issues[0].path).toBe(path);
    }
    await ctx
      .http()
      .post('/api/v1/bookings')
      .set(c.auth)
      .send({ propertyId: property.id, startDate: 'tomorrow', quantity: 1 })
      .expect(422);
    expect(await ctx.prisma.booking.count()).toBe(0);
  });

  it('respects the property availableFrom date', async () => {
    const { property } = await rental(ctx, { ...DAILY, availableFrom: inDays(20) });
    const c = await customer(ctx);
    const res = await ctx
      .http()
      .post('/api/v1/bookings')
      .set(c.auth)
      .send({ propertyId: property.id, startDate: inDays(10), quantity: 1 })
      .expect(422);
    expect(res.body.details.issues[0].path).toBe('startDate');
    await book(ctx, c, { propertyId: property.id, startDate: inDays(20), quantity: 1 });
  });

  it('[1] sale properties never enter the rental booking flow', async () => {
    const agent = await createAgent(ctx);
    const sale = await createPublished(ctx, agent, {
      listingType: 'SALE',
      pricingPeriod: 'SALE',
      priceKobo: 9_000_000_000,
    });
    const c = await customer(ctx);
    for (const res of [
      await quote({ propertyId: sale.id, startDate: inDays(5), quantity: 1 }),
      await ctx
        .http()
        .post('/api/v1/bookings')
        .set(c.auth)
        .send({ propertyId: sale.id, startDate: inDays(5), quantity: 1 }),
      await ctx.http().get(`/api/v1/properties/${sale.id}/availability`),
    ]) {
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('PROPERTY_NOT_BOOKABLE');
    }
    expect(await ctx.prisma.booking.count()).toBe(0);
  });

  it('unpublished properties cannot be booked', async () => {
    const { property } = await rental(ctx);
    await ctx.prisma.property.update({ where: { id: property.id }, data: { status: 'SUSPENDED' } });
    const c = await customer(ctx);
    await ctx
      .http()
      .post('/api/v1/bookings')
      .set(c.auth)
      .send({ propertyId: property.id, startDate: inDays(5), quantity: 1 })
      .expect(404);
  });

  it('[4][5][10] prices, fees, status and ownership cannot be injected', async () => {
    const { property } = await rental(ctx);
    const victim = await customer(ctx);
    const attacker = await customer(ctx);
    const b = await book(ctx, attacker, {
      propertyId: property.id,
      startDate: inDays(4),
      quantity: 2,
      totalKobo: 100,
      serviceFeeKobo: 0,
      vatKobo: 0,
      agentCommissionKobo: 0,
      agentPayoutKobo: 999_999_999,
      status: 'CONFIRMED',
      customerId: victim.id,
      pricingConfigId: '00000000-0000-0000-0000-000000000000',
      lines: [{ kind: 'RENT', amountKobo: 1 }],
    });
    const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.customerId).toBe(attacker.id);
    expect(row.status).toBe('AWAITING_PAYMENT');
    expect(row.totalKobo).toBe(11_075_000n);
    expect(row.serviceFeeKobo).toBe(1_000_000n);
    expect(row.agentPayoutKobo).toBe(9_500_000n);
  });

  it('refuses to charge a total the customer was not shown', async () => {
    const { property } = await rental(ctx);
    const c = await customer(ctx);
    const res = await ctx
      .http()
      .post('/api/v1/bookings')
      .set(c.auth)
      .send({ propertyId: property.id, startDate: inDays(4), quantity: 2, expectedTotalKobo: 1 })
      .expect(409);
    expect(res.body).toMatchObject({
      code: 'BOOKING_PRICE_CHANGED',
      details: { totalKobo: 11_075_000 },
    });
    await book(ctx, c, {
      propertyId: property.id,
      startDate: inDays(4),
      quantity: 2,
      expectedTotalKobo: 11_075_000,
    });
  });

  it('limits how many unpaid holds one customer can keep', async () => {
    const { property } = await rental(ctx);
    const c = await customer(ctx);
    for (let i = 0; i < 3; i++)
      await book(ctx, c, { propertyId: property.id, startDate: inDays(5 + i * 3), quantity: 1 });
    await ctx
      .http()
      .post('/api/v1/bookings')
      .set(c.auth)
      .send({ propertyId: property.id, startDate: inDays(20), quantity: 1 })
      .expect(409);
  });
});

describe('availability', () => {
  beforeEach(() => setPricing(ctx));

  it('[6] overlapping dates are refused by the server; back-to-back stays are fine', async () => {
    const { property } = await rental(ctx);
    const [a, b, c] = [await customer(ctx), await customer(ctx), await customer(ctx)];
    await book(ctx, a, { propertyId: property.id, startDate: inDays(10), quantity: 3 }); // 10–13
    const clash = await ctx
      .http()
      .post('/api/v1/bookings')
      .set(b.auth)
      .send({ propertyId: property.id, startDate: inDays(12), quantity: 3 })
      .expect(409);
    expect(clash.body.code).toBe('DATES_UNAVAILABLE');
    await ctx
      .http()
      .post('/api/v1/bookings')
      .set(b.auth)
      .send({ propertyId: property.id, startDate: inDays(8), quantity: 5 })
      .expect(409); // 8–13 covers it
    await book(ctx, b, { propertyId: property.id, startDate: inDays(13), quantity: 2 }); // check-in on check-out day
    await book(ctx, c, { propertyId: property.id, startDate: inDays(8), quantity: 2 }); // ends on check-in day

    const q = (
      await quote({ propertyId: property.id, startDate: inDays(11), quantity: 1 }).expect(200)
    ).body.data;
    expect(q.available).toBe(false);
  });

  it('exposes booked ranges for the calendar without customer data', async () => {
    const { property } = await rental(ctx);
    const c = await customer(ctx);
    await book(ctx, c, { propertyId: property.id, startDate: inDays(10), quantity: 3 });
    const res = await ctx
      .http()
      .get(`/api/v1/properties/${property.id}/availability?startDate=${inDays(11)}&quantity=2`)
      .expect(200);
    expect(res.body.data).toMatchObject({
      pricingPeriod: 'DAILY',
      earliestStartDate: inDays(0),
      limits: { min: 1, max: 90, unit: 'night' },
      unavailable: [{ startDate: inDays(10), endDate: inDays(13) }],
      check: { available: false },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/customer|email|reference|HH-/);
  });

  it('[12] concurrent attempts for the same dates: exactly one succeeds', async () => {
    const { property } = await rental(ctx);
    const customers = await Promise.all(Array.from({ length: 6 }, () => customer(ctx)));
    const results = await Promise.all(
      customers.map((c) =>
        ctx
          .http()
          .post('/api/v1/bookings')
          .set(c.auth)
          .send({ propertyId: property.id, startDate: inDays(10), quantity: 4 }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
    expect(await ctx.prisma.booking.count({ where: { propertyId: property.id } })).toBe(1);
  });

  it('[12] the database itself rejects overlapping holds, even bypassing the service', async () => {
    const { property } = await rental(ctx);
    const c = await customer(ctx);
    const b = await book(ctx, c, { propertyId: property.id, startDate: inDays(10), quantity: 3 });
    const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    const {
      id: _id,
      reference: _ref,
      createdAt: _c,
      updatedAt: _u,
      propertySnapshot,
      ...rest
    } = row;
    await expect(
      ctx.prisma.booking.create({
        data: {
          ...rest,
          propertySnapshot: propertySnapshot as object,
          reference: 'HH-RAWINSRT',
          startDate: new Date(`${inDays(12)}T00:00:00Z`),
          endDate: new Date(`${inDays(14)}T00:00:00Z`),
        },
      }),
    ).rejects.toSatisfy(isOverlapViolation);
    // A cancelled booking no longer holds its dates, at the database level too.
    await ctx.http().post(`/api/v1/bookings/${b.id}/cancel`).set(c.auth).send({}).expect(200);
    await ctx.prisma.booking.create({
      data: {
        ...rest,
        status: 'CANCELLED',
        propertySnapshot: propertySnapshot as object,
        reference: 'HH-RAWINSR2',
        startDate: new Date(`${inDays(12)}T00:00:00Z`),
        endDate: new Date(`${inDays(14)}T00:00:00Z`),
      },
    });
  });
});

describe('expiry and cancellation', () => {
  beforeEach(() => setPricing(ctx));

  it('unpaid holds expire, release their dates, and cannot be paid', async () => {
    const { property } = await rental(ctx);
    const [a, b] = [await customer(ctx), await customer(ctx)];
    const first = await book(ctx, a, {
      propertyId: property.id,
      startDate: inDays(10),
      quantity: 3,
    });
    await ctx.prisma.booking.update({
      where: { id: first.id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });

    // The lapsed hold no longer blocks anyone…
    expect(
      (await quote({ propertyId: property.id, startDate: inDays(10), quantity: 3 })).body.data
        .available,
    ).toBe(true);
    // …and paying it is refused.
    const pay = await ctx
      .http()
      .post(`/api/v1/bookings/${first.id}/payments`)
      .set(a.auth)
      .expect(409);
    expect(pay.body.code).toBe('BOOKING_HOLD_EXPIRED');
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: first.id } })).status).toBe(
      'EXPIRED',
    );
    await book(ctx, b, { propertyId: property.id, startDate: inDays(10), quantity: 3 });
  });

  it('the sweep expires lapsed holds, with an audit entry', async () => {
    const { property } = await rental(ctx);
    const c = await customer(ctx);
    const b = await book(ctx, c, { propertyId: property.id, startDate: inDays(10), quantity: 3 });
    await ctx.prisma.booking.update({
      where: { id: b.id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });
    const result = await ctx.app.get(BookingMaintenanceService).runOnce();
    expect(result.expired).toBe(1);
    const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.status).toBe('EXPIRED');
    expect(row.expiredAt).not.toBeNull();
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'booking.expired', resourceId: b.id } }),
    ).toBe(1);
  });

  it('a customer cancels an unpaid booking; nothing is refunded and the dates free up', async () => {
    const { property } = await rental(ctx);
    const [a, b] = [await customer(ctx), await customer(ctx)];
    const first = await book(ctx, a, {
      propertyId: property.id,
      startDate: inDays(10),
      quantity: 3,
    });
    const res = await ctx
      .http()
      .post(`/api/v1/bookings/${first.id}/cancel`)
      .set(a.auth)
      .send({ reason: 'Plans changed' })
      .expect(200);
    expect(res.body.data).toMatchObject({
      status: 'CANCELLED',
      canCancel: false,
      canPay: false,
      cancellation: { cancelledBy: 'CUSTOMER', reason: 'Plans changed' },
      refund: null,
    });
    await ctx.http().post(`/api/v1/bookings/${first.id}/cancel`).set(a.auth).send({}).expect(409);
    await book(ctx, b, { propertyId: property.id, startDate: inDays(10), quantity: 3 });
  });

  it('[7] expired and cancelled bookings can never be paid or confirmed', async () => {
    const { property } = await rental(ctx);
    const c = await customer(ctx);
    const cancelled = await book(ctx, c, {
      propertyId: property.id,
      startDate: inDays(10),
      quantity: 1,
    });
    await ctx
      .http()
      .post(`/api/v1/bookings/${cancelled.id}/cancel`)
      .set(c.auth)
      .send({})
      .expect(200);
    const res = await ctx
      .http()
      .post(`/api/v1/bookings/${cancelled.id}/payments`)
      .set(c.auth)
      .expect(409);
    expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
    expect(
      (await ctx.prisma.booking.findUniqueOrThrow({ where: { id: cancelled.id } })).status,
    ).toBe('CANCELLED');
  });
});

describe('price snapshots', () => {
  beforeEach(() => setPricing(ctx));

  it('[11] later price, discount and fee changes never alter an existing booking', async () => {
    const { property, agent } = await rental(ctx, { ...DAILY, cautionFeeKobo: 1_000_000 });
    const c = await customer(ctx);
    const b = await book(ctx, c, { propertyId: property.id, startDate: inDays(10), quantity: 2 });

    await ctx
      .http()
      .patch(`/api/v1/agents/me/properties/${property.id}`)
      .set(agent.auth)
      .send({
        priceKobo: 9_900_000,
        discountPercent: 50,
        cautionFeeKobo: 0,
        title: 'Renamed apartment listing',
      })
      .expect(200);
    // Editing a live listing sends it back to moderation (Phase 2); approve it again.
    await ctx
      .http()
      .patch(`/api/v1/admin/properties/${property.id}/moderation`)
      .set(await moderatorAuth(ctx))
      .send({ action: 'APPROVE' })
      .expect(200);
    await setPricing(ctx, { serviceFeeBps: 2500, vatBps: 1000 });

    const after = (await ctx.http().get(`/api/v1/bookings/${b.id}`).set(c.auth).expect(200)).body
      .data;
    expect(after.totalKobo).toBe(b.totalKobo);
    expect(after.lines).toEqual(b.lines);
    expect(after.snapshot).toMatchObject({
      unitPriceKobo: 5_000_000,
      discountPercent: null,
      title: b.snapshot.title,
    });

    // New quotes use the new price and rates.
    const fresh = (
      await quote({ propertyId: property.id, startDate: inDays(30), quantity: 2 }).expect(200)
    ).body.data;
    expect(fresh.totalKobo).not.toBe(b.totalKobo);

    // Paying charges the frozen amount, and the agent sees the frozen figures.
    const { payment } = await payWithTestProvider(ctx, c, b.id);
    expect(payment.amountKobo).toBe(b.totalKobo);
    const agentView = (
      await ctx.http().get(`/api/v1/agents/me/bookings/${b.id}`).set(agent.auth).expect(200)
    ).body.data;
    expect(agentView.financials).toMatchObject({
      stayKobo: 10_000_000,
      payoutKobo: 9_500_000,
      cautionKobo: 1_000_000,
    });
  });
});

describe('access control', () => {
  beforeEach(() => setPricing(ctx));

  it('[8] unauthenticated users cannot reach private bookings', async () => {
    await ctx.http().get('/api/v1/bookings').expect(401);
    await ctx.http().post('/api/v1/bookings').send({}).expect(401);
    await ctx.http().get('/api/v1/agents/me/bookings').expect(401);
    await ctx.http().get('/api/v1/admin/bookings').expect(401);
  });

  it('[2] customers only ever see and cancel their own bookings', async () => {
    const { property } = await rental(ctx);
    const [owner, other] = [await customer(ctx), await customer(ctx)];
    const b = await book(ctx, owner, {
      propertyId: property.id,
      startDate: inDays(10),
      quantity: 2,
    });
    await ctx.http().get(`/api/v1/bookings/${b.id}`).set(other.auth).expect(404);
    await ctx.http().post(`/api/v1/bookings/${b.id}/cancel`).set(other.auth).send({}).expect(404);
    await ctx.http().post(`/api/v1/bookings/${b.id}/payments`).set(other.auth).expect(404);
    expect(
      (await ctx.http().get('/api/v1/bookings').set(other.auth).expect(200)).body.data.total,
    ).toBe(0);
    expect(
      (await ctx.http().get('/api/v1/bookings').set(owner.auth).expect(200)).body.data.total,
    ).toBe(1);
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe(
      'AWAITING_PAYMENT',
    );
  });

  it('[3] agents see bookings on their own properties only, and cannot touch others', async () => {
    const { property, agent } = await rental(ctx);
    const outsider = await createAgent(ctx);
    const c = await customer(ctx);
    const b = await book(ctx, c, { propertyId: property.id, startDate: inDays(10), quantity: 2 });

    const mine = (await ctx.http().get('/api/v1/agents/me/bookings').set(agent.auth).expect(200))
      .body.data;
    expect(mine.items.map((i: { id: string }) => i.id)).toEqual([b.id]);
    const detail = (
      await ctx.http().get(`/api/v1/agents/me/bookings/${b.id}`).set(agent.auth).expect(200)
    ).body.data;
    // Unpaid: no contact details yet.
    expect(detail.customer).toEqual({ fullName: 'Chiamaka Okafor', email: null, phone: null });

    expect(
      (await ctx.http().get('/api/v1/agents/me/bookings').set(outsider.auth).expect(200)).body.data
        .total,
    ).toBe(0);
    await ctx.http().get(`/api/v1/agents/me/bookings/${b.id}`).set(outsider.auth).expect(404);
    await ctx
      .http()
      .post(`/api/v1/agents/me/bookings/${b.id}/cancel`)
      .set(outsider.auth)
      .send({})
      .expect(404);
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe(
      'AWAITING_PAYMENT',
    );

    // The owning agent may cancel (before the stay starts).
    await ctx
      .http()
      .post(`/api/v1/agents/me/bookings/${b.id}/cancel`)
      .set(agent.auth)
      .send({ reason: 'Maintenance' })
      .expect(200);
  });

  it('only customer accounts can book', async () => {
    const { property, agent } = await rental(ctx);
    const admin = await adminAuth(ctx, ['super_admin']);
    for (const auth of [agent.auth, admin.auth]) {
      await ctx
        .http()
        .post('/api/v1/bookings')
        .set(auth)
        .send({ propertyId: property.id, startDate: inDays(5), quantity: 1 })
        .expect(403);
    }
  });

  it.each(['SUSPENDED', 'BLOCKED'] as const)(
    '[9] %s customers cannot create bookings',
    async (status) => {
      const { property } = await rental(ctx);
      const c = await customer(ctx);
      await ctx.prisma.user.update({ where: { id: c.id }, data: { status } });
      const res = await ctx
        .http()
        .post('/api/v1/bookings')
        .set(c.auth)
        .send({ propertyId: property.id, startDate: inDays(5), quantity: 1 })
        .expect(403);
      expect(res.body.code).toBe(status === 'BLOCKED' ? 'ACCOUNT_BLOCKED' : 'ACCOUNT_SUSPENDED');
      expect(await ctx.prisma.booking.count()).toBe(0);
    },
  );

  it('admins need bookings.view; payment detail needs payments.view too', async () => {
    const { property } = await rental(ctx);
    const c = await customer(ctx);
    const b = await book(ctx, c, { propertyId: property.id, startDate: inDays(10), quantity: 2 });
    await payWithTestProvider(ctx, c, b.id);

    const propertyManager = await adminAuth(ctx, ['property_manager']);
    await ctx.http().get('/api/v1/admin/bookings').set(propertyManager.auth).expect(403);

    const support = await adminAuth(ctx, ['support_admin']);
    const supportView = (
      await ctx.http().get(`/api/v1/admin/bookings/${b.id}`).set(support.auth).expect(200)
    ).body.data;
    expect(supportView.status).toBe('CONFIRMED');
    expect(supportView.payments).toEqual([]);
    expect(supportView.ledger).toEqual([]);
    await ctx
      .http()
      .post(`/api/v1/admin/bookings/${b.id}/cancel`)
      .set(support.auth)
      .send({})
      .expect(403);
    await ctx.http().get('/api/v1/admin/payments').set(support.auth).expect(403);

    const finance = await adminAuth(ctx, ['finance_admin']);
    const financeView = (
      await ctx.http().get(`/api/v1/admin/bookings/${b.id}`).set(finance.auth).expect(200)
    ).body.data;
    expect(financeView.payments).toHaveLength(1);
    expect(financeView.ledger.length).toBeGreaterThan(0);
    expect(financeView.financials).toMatchObject({
      serviceFeeKobo: 1_000_000,
      agentCommissionKobo: 500_000,
      pricingConfigVersion: 1,
    });
    const list = (
      await ctx
        .http()
        .get('/api/v1/admin/bookings?search=' + b.reference)
        .set(finance.auth)
        .expect(200)
    ).body.data;
    expect(list.items.map((i: { id: string }) => i.id)).toEqual([b.id]);
  });

  it('only payments.settings can change commission and VAT, and every change is versioned and audited', async () => {
    await adminAuth(ctx, ['admin']).then(async (admin) => {
      await ctx
        .http()
        .post('/api/v1/admin/finance/pricing')
        .set(admin.auth)
        .send({
          serviceFeeBps: 0,
          agentCommissionBps: 0,
          vatBps: 0,
          vatOnServiceFee: false,
          vatOnStay: false,
        })
        .expect(403);
    });
    const finance = await adminAuth(ctx, ['finance_admin']);
    await ctx
      .http()
      .post('/api/v1/admin/finance/pricing')
      .set(finance.auth)
      .send({
        serviceFeeBps: 6000,
        agentCommissionBps: 0,
        vatBps: 750,
        vatOnServiceFee: true,
        vatOnStay: false,
      })
      .expect(422);
    const saved = (
      await ctx
        .http()
        .post('/api/v1/admin/finance/pricing')
        .set(finance.auth)
        .send({
          serviceFeeBps: 800,
          agentCommissionBps: 300,
          vatBps: 750,
          vatOnServiceFee: true,
          vatOnStay: false,
          note: 'Launch rates',
        })
        .expect(201)
    ).body.data;
    expect(saved).toMatchObject({ version: 2, serviceFeeBps: 800, note: 'Launch rates' });
    const history = (
      await ctx.http().get('/api/v1/admin/finance/pricing').set(finance.auth).expect(200)
    ).body.data;
    expect(history.current.version).toBe(2);
    expect(history.history).toHaveLength(2);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'finance.pricing_config.created' } }),
    ).toBe(2);
  });
});

describe('time-based lifecycle', () => {
  beforeEach(() => setPricing(ctx));

  it('earnings become payable when the stay starts; stays complete at check-out', async () => {
    const { property } = await rental(ctx);
    const c = await customer(ctx);
    const b = await book(ctx, c, { propertyId: property.id, startDate: inDays(2), quantity: 3 });
    await payWithTestProvider(ctx, c, b.id);
    const sweep = ctx.app.get(BookingMaintenanceService);

    expect(await sweep.runOnce(inDays(1))).toMatchObject({ released: 0, completed: 0 });
    expect(
      (await ctx.prisma.agentEarning.findUniqueOrThrow({ where: { bookingId: b.id } })).status,
    ).toBe('PENDING');

    expect(await sweep.runOnce(inDays(2))).toMatchObject({ released: 1, completed: 0 });
    expect(
      (await ctx.prisma.agentEarning.findUniqueOrThrow({ where: { bookingId: b.id } })).status,
    ).toBe('AVAILABLE');

    expect(await sweep.runOnce(inDays(5))).toMatchObject({ completed: 1 });
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe(
      'COMPLETED',
    );
    // Completed stays still hold their dates.
    expect(
      (await quote({ propertyId: property.id, startDate: inDays(3), quantity: 1 })).body.data
        .available,
    ).toBe(false);
  });
});

describe('payment start', () => {
  beforeEach(() => setPricing(ctx));

  it('payment attempts carry the frozen total and a unique reference', async () => {
    const { property } = await rental(ctx);
    const c = await customer(ctx);
    const b = await book(ctx, c, { propertyId: property.id, startDate: inDays(10), quantity: 2 });
    const first = await startPayment(ctx, c, b.id);
    const second = await startPayment(ctx, c, b.id);
    expect(first.reference).not.toBe(second.reference);
    expect(first).toMatchObject({ provider: 'TEST', amountKobo: b.totalKobo });
    expect(first.authorizationUrl).toBe(
      `http://localhost:3000/payments/test-checkout?reference=${first.reference}`,
    );
  });
});
