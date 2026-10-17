import type {
  AgentExperienceView,
  CustomerBookingDetail,
  EntitlementKey,
  ExperienceBookingQuote,
} from '@havenhub/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BookingMaintenanceService } from '../src/modules/bookings/booking-maintenance.service';

import {
  adminAuth,
  customer,
  inDays,
  ledgerTotals,
  payWithTestProvider,
  setPricing,
  type Customer,
} from './helpers/booking-helpers';
import {
  createAgent,
  createTestContext,
  testImage,
  type Agent,
  type TestContext,
} from './helpers/test-app';

let ctx: TestContext;
const BASE = '/api/v1/agents/me/experiences';
const DAY = 86_400_000;
const future = (days: number, hour: number) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(async () => {
  await ctx.reset();
  const plan = await ctx.prisma.subscriptionPlan.findFirstOrThrow({ where: { isDefault: true } });
  for (const key of ['EVENT_COUNT', 'TOUR_COUNT', 'HOTEL_COUNT'] as EntitlementKey[]) {
    await ctx.prisma.subscriptionPlanEntitlement.update({
      where: { planId_key: { planId: plan.id, key } },
      data: { limit: 5 },
    });
  }
  await setPricing(ctx);
});
afterAll(() => ctx.close());

const common = {
  description: 'A well described listing with everything a guest needs to know about it.',
  addressLine: '1 Marina Road',
  city: 'Lagos Island',
  state: 'Lagos',
  onlineBooking: true,
};

const ITEMS = [
  { category: 'TOUR_FEE', name: 'Tour fee', priceKobo: 1_000_000, perPerson: true },
  { category: 'FOOD', name: 'Lunch', priceKobo: 300_000, perPerson: true },
  { category: 'TRANSPORT', name: 'Bus', priceKobo: 500_000, perPerson: false },
];

async function publish(
  agent: Agent,
  body: Record<string, unknown>,
  setup?: (id: string) => Promise<void>,
) {
  const res = await ctx
    .http()
    .post(BASE)
    .set(agent.auth)
    .send({ ...common, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const id = (res.body.data as AgentExperienceView).id;
  await setup?.(id);
  await ctx
    .http()
    .post(`${BASE}/${id}/images`)
    .set(agent.auth)
    .attach('file', await testImage(), { filename: 'photo.jpg', contentType: 'image/jpeg' })
    .expect(201);
  await ctx.http().post(`${BASE}/${id}/submit`).set(agent.auth).expect(200);
  await ctx
    .http()
    .patch(`/api/v1/admin/experiences/${id}/moderation`)
    .set((await adminAuth(ctx, ['property_manager'])).auth)
    .send({ action: 'APPROVE' })
    .expect(200);
  return (await ctx.http().get(`${BASE}/${id}`).set(agent.auth).expect(200)).body
    .data as AgentExperienceView;
}

const putItems = (agent: Agent, id: string, items = ITEMS) =>
  ctx.http().put(`${BASE}/${id}/package-items`).set(agent.auth).send({ items }).expect(200);

async function tour(agent: Agent, extra: Record<string, unknown> = {}) {
  return publish(
    agent,
    {
      kind: 'TOUR',
      title: 'Badagry heritage tour',
      tour: { category: 'CULTURAL_EXPERIENCE' },
      ...extra,
    },
    async (id) => {
      await putItems(agent, id);
    },
  );
}

const quote = (body: Record<string, unknown>) =>
  ctx.http().post('/api/v1/bookings/experience/quote').send(body);

async function bookExperience(who: Customer, body: Record<string, unknown>, expected = 201) {
  const res = await ctx.http().post('/api/v1/bookings/experience').set(who.auth).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(expected);
  return res.body.data as CustomerBookingDetail;
}

describe('tours: per day, full package or chosen items', () => {
  it('prices the full package and a selection, then books and pays like a rental', async () => {
    const agent = await createAgent(ctx);
    const listing = await tour(agent);
    const items = listing.packageItems;
    expect(items.map((i) => i.name)).toEqual(['Tour fee', 'Lunch', 'Bus']);

    const detail = (await ctx.http().get(`/api/v1/experiences/${listing.slug}`).expect(200)).body
      .data;
    expect(detail).toMatchObject({ bookable: true });

    const base = { experienceId: listing.id, startDate: inDays(5), days: 2, people: 3 };
    const full = (await quote({ ...base, fullPackage: true }).expect(200)).body
      .data as ExperienceBookingQuote;
    // Tour fee 10k×2×3 + lunch 3k×2×3 + bus 5k×2 = ₦88,000 → +10% fee + 7.5% VAT on the fee
    expect(full.lines.filter((l) => l.kind === 'PACKAGE_ITEM').map((l) => l.amountKobo)).toEqual([
      6_000_000, 1_800_000, 1_000_000,
    ]);
    expect(full.totalKobo).toBe(8_800_000 + 880_000 + 66_000);
    expect(full).toMatchObject({ available: true, endDate: inDays(7) });

    const some = (await quote({ ...base, itemIds: [items[0]!.id] }).expect(200)).body
      .data as ExperienceBookingQuote;
    expect(some.totalKobo).toBe(6_000_000 + 600_000 + 45_000);

    await quote({ ...base, itemIds: [] }).expect(422);

    const c = await customer(ctx);
    const booking = await bookExperience(c, {
      ...base,
      fullPackage: true,
      expectedTotalKobo: full.totalKobo,
    });
    expect(booking).toMatchObject({
      status: 'AWAITING_PAYMENT',
      totalKobo: full.totalKobo,
      canReview: false,
      property: { kind: 'TOUR', href: `/tours/${listing.slug}`, title: listing.title },
      selection: { people: 3, fullPackage: true },
    });
    expect(booking.selection!.items.map((i) => i.name)).toEqual(['Tour fee', 'Lunch', 'Bus']);

    const { verification } = await payWithTestProvider(ctx, c, booking.id);
    expect(verification.bookingStatus).toBe('CONFIRMED');
    const { bySource } = await ledgerTotals(ctx, booking.id);
    expect([...bySource.values()]).toEqual([BigInt(full.totalKobo)]);

    // The agent sees it among their bookings.
    const agentList = await ctx
      .http()
      .get('/api/v1/agents/me/bookings')
      .set(agent.auth)
      .expect(200);
    expect(agentList.body.data.items[0]).toMatchObject({ reference: booking.reference });
  });

  it('refuses a booking that would go over the tour capacity on any day', async () => {
    const agent = await createAgent(ctx);
    const listing = await tour(agent, { tour: { category: 'CULTURAL_EXPERIENCE', capacity: 3 } });
    const body = { experienceId: listing.id, startDate: inDays(5), days: 2, fullPackage: true };
    await bookExperience(await customer(ctx), { ...body, people: 2 });
    const second = await customer(ctx);
    const q = (await quote({ ...body, startDate: inDays(6), people: 2 }).expect(200)).body.data;
    expect(q).toMatchObject({ available: false });
    expect(q.unavailableReason).toMatch(/1 place is left/);
    await bookExperience(second, { ...body, startDate: inDays(6), people: 2 }, 409);
    // The day after the first booking ends is free again.
    await bookExperience(second, { ...body, startDate: inDays(7), people: 3 });
  });

  it('only starts on the dates a tour runs, when it lists dates', async () => {
    const agent = await createAgent(ctx);
    const listing = await tour(agent);
    await ctx
      .http()
      .put(`${BASE}/${listing.id}/tour-dates`)
      .set(agent.auth)
      .send({ dates: [future(10, 9)] })
      .expect(200);
    const body = { experienceId: listing.id, days: 1, fullPackage: true };
    await quote({ ...body, startDate: inDays(9) }).expect(422);
    await quote({ ...body, startDate: inDays(10) }).expect(200);
  });
});

describe('hotels: rooms per night', () => {
  async function hotel(agent: Agent) {
    let roomIds: string[] = [];
    let roomTypeId = '';
    const listing = await publish(
      agent,
      { kind: 'HOTEL', title: 'Harbour View Hotel', hotel: { food: 'Breakfast' } },
      async (id) => {
        const withType = (
          await ctx
            .http()
            .post(`${BASE}/${id}/room-types`)
            .set(agent.auth)
            .send({ name: 'Deluxe', priceKobo: 4_000_000, maxGuests: 2 })
            .expect(201)
        ).body.data as AgentExperienceView;
        roomTypeId = withType.hotel!.roomTypes[0]!.id;
        for (const label of ['101', '102']) {
          const view = (
            await ctx
              .http()
              .post(`${BASE}/${id}/rooms`)
              .set(agent.auth)
              .send({ roomTypeId, label })
              .expect(201)
          ).body.data as AgentExperienceView;
          roomIds = view.hotel!.rooms.map((r) => r.id);
        }
        await putItems(agent, id, [
          { category: 'FOOD', name: 'Dinner', priceKobo: 500_000, perPerson: true },
        ]);
      },
    );
    return { listing, roomTypeId, roomIds };
  }

  it('holds real rooms, honours closed dates and date prices, and never double-books', async () => {
    const agent = await createAgent(ctx);
    const { listing, roomTypeId, roomIds } = await hotel(agent);
    // Room 101 is closed on night 2; room 102 costs ₦50,000 on night 1.
    await ctx
      .http()
      .put(`${BASE}/${listing.id}/rooms/${roomIds[0]}/availability`)
      .set(agent.auth)
      .send({ set: [{ date: inDays(6), available: false }] })
      .expect(200);
    await ctx
      .http()
      .put(`${BASE}/${listing.id}/rooms/${roomIds[1]}/availability`)
      .set(agent.auth)
      .send({ set: [{ date: inDays(5), available: true, priceKobo: 5_000_000 }] })
      .expect(200);

    const body = { experienceId: listing.id, roomTypeId, startDate: inDays(5), days: 2, people: 2 };
    const q = (await quote(body).expect(200)).body.data as ExperienceBookingQuote;
    // Only room 102 is open both nights: ₦50,000 + ₦40,000.
    expect(q.lines[0]).toMatchObject({ kind: 'ROOM', amountKobo: 9_000_000 });
    expect(q.available).toBe(true);
    await quote({ ...body, rooms: 2 })
      .expect(200)
      .expect((r) => {
        expect(r.body.data.available).toBe(false);
      });
    await quote({ ...body, people: 3 }).expect(422);

    const withDinner = (await quote({ ...body, fullPackage: true }).expect(200)).body.data;
    expect(withDinner.lines.map((l: { kind: string }) => l.kind)).toEqual([
      'ROOM',
      'PACKAGE_ITEM',
      'SERVICE_FEE',
      'VAT',
    ]);

    const first = await bookExperience(await customer(ctx), body);
    const held = await ctx.prisma.bookingHotelRoom.findMany({ where: { bookingId: first.id } });
    expect(held.map((h) => h.roomId)).toEqual([roomIds[1]]);
    await bookExperience(await customer(ctx), body, 409);
    // Night 1 alone: room 101 is open again.
    await bookExperience(await customer(ctx), { ...body, days: 1 });
    // A booked room cannot be deleted.
    await ctx
      .http()
      .delete(`${BASE}/${listing.id}/rooms/${roomIds[1]}`)
      .set(agent.auth)
      .expect(409);
  });
});

describe('events: ticket per person per day', () => {
  it('prices the chosen ticket for the event days only', async () => {
    const agent = await createAgent(ctx);
    const listing = await publish(
      agent,
      {
        kind: 'EVENT',
        title: 'Lagos Food Festival',
        event: { startsAt: future(20, 9), endsAt: future(22, 20), capacity: 100 },
      },
      async (id) => {
        await ctx
          .http()
          .put(`${BASE}/${id}/ticket-types`)
          .set(agent.auth)
          .send({ ticketTypes: [{ kind: 'REGULAR', name: 'Regular', priceKobo: 1_000_000 }] })
          .expect(200);
      },
    );
    const ticketTypeId = listing.event!.ticketTypes[0]!.id;
    const body = { experienceId: listing.id, ticketTypeId, people: 2 };
    const q = (await quote({ ...body, startDate: inDays(20), days: 3 }).expect(200)).body.data;
    expect(q.lines[0]).toMatchObject({ kind: 'TICKET', amountKobo: 6_000_000 });
    await quote({ ...body, startDate: inDays(20), days: 4 }).expect(422);
    await quote({ ...body, startDate: inDays(19), days: 1 }).expect(422);
    await quote({ experienceId: listing.id, people: 2, startDate: inDays(20), days: 1 }).expect(
      422,
    );
  });
});

describe('online booking is opt-in', () => {
  it('is refused when the agent has not switched it on', async () => {
    const agent = await createAgent(ctx);
    const listing = await tour(agent, { onlineBooking: false });
    const detail = (await ctx.http().get(`/api/v1/experiences/${listing.slug}`).expect(200)).body
      .data;
    expect(detail.bookable).toBe(false);
    await quote({
      experienceId: listing.id,
      startDate: inDays(3),
      days: 1,
      fullPackage: true,
    }).expect(422);
    // Cleaning services can take online bookings too.
    await ctx
      .http()
      .post(BASE)
      .set(agent.auth)
      .send({ kind: 'CLEANING', title: 'Sparkle cleaning', onlineBooking: true })
      .expect(201);
  });
});

describe('direct messages to an agent', () => {
  it('a customer can message an agent without a listing or booking; agents cannot start one', async () => {
    const agent = await createAgent(ctx);
    const c = await customer(ctx);
    const res = await ctx
      .http()
      .post('/api/v1/conversations')
      .set(c.auth)
      .send({ contextType: 'AGENT', agentId: agent.agentProfileId })
      .expect(200);
    expect(res.body.data.context).toMatchObject({
      type: 'AGENT',
      agent: { id: agent.agentProfileId },
    });
    // Get-or-create: the same conversation comes back.
    const again = await ctx
      .http()
      .post('/api/v1/conversations')
      .set(c.auth)
      .send({ contextType: 'AGENT', agentId: agent.agentProfileId });
    expect(again.body.data.id).toBe(res.body.data.id);
    const other = await createAgent(ctx);
    await ctx
      .http()
      .post('/api/v1/conversations')
      .set(other.auth)
      .send({ contextType: 'AGENT', agentId: agent.agentProfileId })
      .expect(403);
  });
});

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const weekday = (iso: string) => WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()]!;

async function cleaner(agent: Agent, dailyCapacity: number | null = null) {
  return publish(agent, {
    kind: 'CLEANING',
    title: 'Sparkle home cleaning',
    city: 'Warri',
    state: 'Delta',
    cleaning: {
      priceKobo: 1_500_000,
      priceNote: 'per visit',
      serviceAreas: ['Ughelli', 'Warri'],
      availableDays: [weekday(inDays(5))],
      dailyCapacity,
    },
  });
}

describe('cleaning: search by area, pick a date, pay', () => {
  it('finds cleaners covering an area, books an open day with an address, and shares it', async () => {
    const agent = await createAgent(ctx);
    const listing = await cleaner(agent, 1);
    // Based in Warri, but found when searching Ughelli (one of its service areas).
    const found = await ctx.http().get('/api/v1/experiences?kind=CLEANING&q=ughelli').expect(200);
    expect(found.body.data.items.map((i: { id: string }) => i.id)).toEqual([listing.id]);
    const byCity = await ctx
      .http()
      .get('/api/v1/experiences?kind=CLEANING&city=Ughelli')
      .expect(200);
    expect(byCity.body.data.total).toBe(1);

    const body = {
      experienceId: listing.id,
      startDate: inDays(5),
      days: 1,
      serviceArea: 'ughelli',
      address: '12 Market Road, Ughelli',
    };
    const q = (await quote(body).expect(200)).body.data as ExperienceBookingQuote;
    expect(q.lines[0]).toMatchObject({ kind: 'CLEANING_FEE', amountKobo: 1_500_000 });
    await quote({ ...body, startDate: inDays(6) }).expect(422); // not a working day
    await quote({ ...body, serviceArea: 'Lagos' }).expect(422);
    // Quotes work before the address is given; booking needs it.
    await quote({ ...body, address: undefined }).expect(200);
    await bookExperience(await customer(ctx), { ...body, address: undefined }, 422);

    const c = await customer(ctx);
    const booking = await bookExperience(c, body);
    expect(booking.property).toMatchObject({ kind: 'CLEANING', href: `/cleaning/${listing.slug}` });
    expect(booking.selection).toMatchObject({
      serviceArea: 'Ughelli',
      address: '12 Market Road, Ughelli',
    });
    // One booking a day: the day is now full.
    await bookExperience(await customer(ctx), body, 409);
    await payWithTestProvider(ctx, c, booking.id);
    const forAgent = await ctx
      .http()
      .get(`/api/v1/agents/me/bookings/${booking.id}`)
      .set(agent.auth)
      .expect(200);
    expect(forAgent.body.data.selection.address).toBe('12 Market Road, Ughelli');
  });
});

describe('promo codes on tours, events, hotels and cleaning', () => {
  it('apply to the agent’s experiences, or only the ones listed, and are held when booking', async () => {
    const agent = await createAgent(ctx);
    const listing = await tour(agent);
    const other = await cleaner(agent);
    await ctx
      .http()
      .post('/api/v1/agents/me/promo-codes')
      .set(agent.auth)
      .send({ code: 'TOUR10', percentOff: 10, experienceIds: [listing.id] })
      .expect(201);
    const base = { experienceId: listing.id, startDate: inDays(5), days: 1, people: 1 };
    const plain = (await quote({ ...base, itemIds: [listing.packageItems[0]!.id] }).expect(200))
      .body.data as ExperienceBookingQuote;
    const promoted = (
      await quote({ ...base, itemIds: [listing.packageItems[0]!.id], code: 'tour10' }).expect(200)
    ).body.data as ExperienceBookingQuote;
    expect(promoted.promo).toMatchObject({ code: 'TOUR10', amountOffKobo: 100_000 });
    expect(promoted.lines.find((l) => l.kind === 'PROMO_DISCOUNT')!.amountKobo).toBe(-100_000);
    expect(promoted.totalKobo).toBeLessThan(plain.totalKobo);
    // Not listed on the code: refused.
    await quote({
      experienceId: other.id,
      startDate: inDays(5),
      days: 1,
      serviceArea: 'Warri',
      address: '1 Airport Road, Warri',
      code: 'TOUR10',
    }).expect(422);
    // Someone else's code looks unknown.
    const stranger = await createAgent(ctx);
    await ctx
      .http()
      .post('/api/v1/agents/me/promo-codes')
      .set(stranger.auth)
      .send({ code: 'MINE', percentOff: 10 })
      .expect(201);
    await quote({ ...base, fullPackage: true, code: 'MINE' }).expect(422);

    const c = await customer(ctx);
    const booking = await bookExperience(c, {
      ...base,
      itemIds: [listing.packageItems[0]!.id],
      code: 'TOUR10',
    });
    expect(booking.totalKobo).toBe(promoted.totalKobo);
    const held = await ctx.prisma.discountRedemption.findFirstOrThrow({
      where: { bookingId: booking.id },
    });
    expect(held.status).toBe('PENDING');
    await payWithTestProvider(ctx, c, booking.id);
    expect(
      (await ctx.prisma.discountRedemption.findFirstOrThrow({ where: { bookingId: booking.id } }))
        .status,
    ).toBe('REDEEMED');
  });
});

describe('reviews of experience bookings', () => {
  it('a completed tour booking can be reviewed; the rating shows on the listing', async () => {
    const agent = await createAgent(ctx);
    const listing = await tour(agent);
    const c = await customer(ctx);
    const booking = await bookExperience(c, {
      experienceId: listing.id,
      startDate: inDays(5),
      days: 1,
      fullPackage: true,
    });
    await payWithTestProvider(ctx, c, booking.id);
    const review = (body: Record<string, unknown>) =>
      ctx.http().post(`/api/v1/bookings/${booking.id}/review`).set(c.auth).send(body);
    await review({ rating: 5 }).expect(409); // not completed yet
    await ctx.prisma.booking.update({
      where: { id: booking.id },
      data: {
        startDate: new Date(`${inDays(-3)}T00:00:00Z`),
        endDate: new Date(`${inDays(-2)}T00:00:00Z`),
      },
    });
    await ctx.app.get(BookingMaintenanceService).runOnce();
    const detail = await ctx.http().get(`/api/v1/bookings/${booking.id}`).set(c.auth).expect(200);
    expect(detail.body.data).toMatchObject({ status: 'COMPLETED', canReview: true });

    await review({ rating: 4, comment: 'Great guide and a lovely lunch by the beach.' }).expect(
      201,
    );
    const pub = await ctx.http().get(`/api/v1/experiences/${listing.slug}`).expect(200);
    expect(pub.body.data.rating).toMatchObject({ count: 1, average: 4 });
    const list = await ctx.http().get(`/api/v1/experiences/${listing.slug}/reviews`).expect(200);
    expect(list.body.data.items[0]).toMatchObject({ rating: 4 });

    // Hiding it removes it from the rating.
    const moderator = await adminAuth(ctx, ['super_admin']);
    const admin = await ctx.http().get('/api/v1/admin/reviews').set(moderator.auth).expect(200);
    expect(admin.body.data.items[0].listing).toMatchObject({ href: `/tours/${listing.slug}` });
    await ctx
      .http()
      .post(`/api/v1/admin/reviews/${admin.body.data.items[0].id}/hide`)
      .set(moderator.auth)
      .send({ reason: 'Testing moderation' })
      .expect(200);
    const after = await ctx.http().get(`/api/v1/experiences/${listing.slug}`).expect(200);
    expect(after.body.data.rating).toBeNull();
  });
});
