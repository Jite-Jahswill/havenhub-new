import type { AgentExperienceView, EntitlementKey } from '@havenhub/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminAuth, customer } from './helpers/booking-helpers';
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
const future = (days: number, hour = 18) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
const isoDay = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(async () => {
  await ctx.reset();
  // The seeded Free plan includes no events, tours or hotels (0). Most tests
  // need some; the plan-limit tests set their own values.
  await setDefaultLimits({ EVENT_COUNT: 5, TOUR_COUNT: 5, HOTEL_COUNT: 5 });
});
afterAll(() => ctx.close());

async function setDefaultLimits(limits: Partial<Record<EntitlementKey, number | null>>) {
  const plan = await ctx.prisma.subscriptionPlan.findFirstOrThrow({ where: { isDefault: true } });
  for (const [key, limit] of Object.entries(limits)) {
    await ctx.prisma.subscriptionPlanEntitlement.update({
      where: { planId_key: { planId: plan.id, key: key as EntitlementKey } },
      data: { limit },
    });
  }
}

const COMPLETE = {
  EVENT: {
    kind: 'EVENT',
    title: 'Lagos Jazz Night',
    description: 'An evening of live jazz by the lagoon with food, drinks and great company.',
    addressLine: 'Muri Okunola Park',
    city: 'Victoria Island',
    state: 'Lagos',
    event: {
      startsAt: future(30, 18),
      endsAt: future(30, 23),
      capacity: 300,
      organizer: 'Jazz NG',
    },
  },
  TOUR: {
    kind: 'TOUR',
    title: 'Lekki Conservation Centre walk',
    description: 'A guided walk along the canopy walkway with a local naturalist guide.',
    addressLine: 'Lekki-Epe Expressway',
    city: 'Lekki',
    state: 'Lagos',
    tour: { category: 'GUIDED_TOUR', priceKobo: 1_500_000, priceNote: 'per person' },
  },
  HOTEL: {
    kind: 'HOTEL',
    title: 'Harbour View Hotel',
    description: 'A quiet hotel by the harbour with a pool, restaurant and airport shuttle.',
    addressLine: '4 Marina Road',
    city: 'Lagos Island',
    state: 'Lagos',
    hotel: { food: 'Breakfast included', hospitality: '24-hour front desk' },
  },
  CLEANING: {
    kind: 'CLEANING',
    title: 'Sparkle home cleaning',
    description: 'Thorough home and apartment cleaning by a vetted, insured team of cleaners.',
    city: 'Ikeja',
    state: 'Lagos',
    cleaning: {
      priceKobo: 2_000_000,
      priceNote: 'per visit',
      serviceAreas: ['Ikeja', 'Yaba', 'ikeja'],
      availableDays: ['MON', 'WED', 'WED'],
    },
  },
} as const;
type Kind = keyof typeof COMPLETE;

async function create(agent: Agent, kind: Kind, overrides: Record<string, unknown> = {}) {
  const res = await ctx
    .http()
    .post(BASE)
    .set(agent.auth)
    .send({ ...COMPLETE[kind], ...overrides });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as AgentExperienceView;
}

async function addImage(agent: Agent, id: string, expected = 201) {
  const res = await ctx
    .http()
    .post(`${BASE}/${id}/images`)
    .set(agent.auth)
    .attach('file', await testImage(), { filename: 'photo.jpg', contentType: 'image/jpeg' });
  expect(res.status, JSON.stringify(res.body)).toBe(expected);
  return res.body.data as AgentExperienceView;
}

async function moderator() {
  return (await adminAuth(ctx, ['property_manager'])).auth;
}

/** Draft → complete → submit → approved. */
async function publish(agent: Agent, kind: Kind) {
  const draft = await create(agent, kind);
  if (kind === 'HOTEL') await addRoomType(agent, draft.id);
  if (kind === 'EVENT') {
    await ctx
      .http()
      .put(`${BASE}/${draft.id}/ticket-types`)
      .set(agent.auth)
      .send({ ticketTypes: [{ kind: 'REGULAR', name: 'Regular', priceKobo: 1_000_000 }] })
      .expect(200);
  }
  await addImage(agent, draft.id);
  await ctx.http().post(`${BASE}/${draft.id}/submit`).set(agent.auth).expect(200);
  await ctx
    .http()
    .patch(`/api/v1/admin/experiences/${draft.id}/moderation`)
    .set(await moderator())
    .send({ action: 'APPROVE' })
    .expect(200);
  return (await ctx.http().get(`${BASE}/${draft.id}`).set(agent.auth).expect(200)).body
    .data as AgentExperienceView;
}

async function addRoomType(agent: Agent, id: string, name = 'Deluxe', priceKobo = 4_500_000) {
  const res = await ctx
    .http()
    .post(`${BASE}/${id}/room-types`)
    .set(agent.auth)
    .send({ name, priceKobo, maxGuests: 2 });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as AgentExperienceView;
}

const publicDetail = (slug: string) => ctx.http().get(`/api/v1/experiences/${slug}`);

describe('creating listings', () => {
  it.each(Object.keys(COMPLETE) as Kind[])('a verified agent creates a %s draft', async (kind) => {
    const agent = await createAgent(ctx);
    const draft = await create(agent, kind);
    expect(draft).toMatchObject({ kind, status: 'DRAFT' });
    const row = await ctx.prisma.experience.findUniqueOrThrow({
      where: { id: draft.id },
      include: { event: true, tour: true, hotel: true, cleaning: true },
    });
    expect(row.agentProfileId).toBe(agent.agentProfileId);
    // The kind's details row exists from the start; the others never do.
    const key = { EVENT: 'event', TOUR: 'tour', HOTEL: 'hotel', CLEANING: 'cleaning' }[kind];
    for (const k of ['event', 'tour', 'hotel', 'cleaning'] as const) {
      expect(row[k] !== null, k).toBe(k === key);
    }
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'experience.created', resourceId: draft.id },
    });
    expect(audit?.actorId).toBe(agent.userId);
  });

  it('normalises cleaning service areas and days', async () => {
    const draft = await create(await createAgent(ctx), 'CLEANING');
    expect(draft.cleaning).toMatchObject({
      serviceAreas: ['Ikeja', 'Yaba'],
      availableDays: ['MON', 'WED'],
      priceKobo: 2_000_000,
    });
  });

  it('never accepts ownership, status or another kind’s details from the body', async () => {
    const agent = await createAgent(ctx);
    const other = await createAgent(ctx);
    for (const extra of [
      { agentProfileId: other.agentProfileId },
      { status: 'PUBLISHED' },
      { slug: 'chosen-slug' },
      { tour: { category: 'ZOO_TOUR' } },
    ]) {
      await ctx
        .http()
        .post(BASE)
        .set(agent.auth)
        .send({ ...COMPLETE.EVENT, ...extra })
        .expect(422);
    }
  });

  it('rejects an event that ends before it starts, and negative prices', async () => {
    const agent = await createAgent(ctx);
    await ctx
      .http()
      .post(BASE)
      .set(agent.auth)
      .send({ ...COMPLETE.EVENT, event: { startsAt: future(5, 20), endsAt: future(5, 18) } })
      .expect(422);
    await ctx
      .http()
      .post(BASE)
      .set(agent.auth)
      .send({ ...COMPLETE.TOUR, tour: { priceKobo: -1 } })
      .expect(422);
    await ctx
      .http()
      .post(BASE)
      .set(agent.auth)
      .send({ ...COMPLETE.TOUR, tour: { priceKobo: 10.5 } })
      .expect(422);
  });

  it('customers and admins cannot create listings', async () => {
    const c = await customer(ctx);
    await ctx.http().post(BASE).set(c.auth).send(COMPLETE.EVENT).expect(403);
    const admin = await adminAuth(ctx, ['super_admin']);
    await ctx.http().post(BASE).set(admin.auth).send(COMPLETE.EVENT).expect(403);
    await ctx.http().post(BASE).send(COMPLETE.EVENT).expect(401);
  });

  it('a suspended agent can view but not create or change listings', async () => {
    const agent = await createAgent(ctx);
    const draft = await create(agent, 'TOUR');
    await ctx.prisma.agentProfile.update({
      where: { id: agent.agentProfileId },
      data: { verificationStatus: 'SUSPENDED' },
    });
    await ctx.http().get(`${BASE}/${draft.id}`).set(agent.auth).expect(200);
    await ctx.http().post(BASE).set(agent.auth).send(COMPLETE.TOUR).expect(403);
    await ctx
      .http()
      .patch(`${BASE}/${draft.id}`)
      .set(agent.auth)
      .send({ title: 'New title here' })
      .expect(403);
  });
});

describe('ownership', () => {
  it('another agent’s listing does not exist for you (404 everywhere)', async () => {
    const owner = await createAgent(ctx);
    const intruder = await createAgent(ctx);
    const event = await create(owner, 'EVENT');
    const hotel = await create(owner, 'HOTEL');
    const roomType = (await addRoomType(owner, hotel.id)).hotel!.roomTypes[0]!;

    const calls = [
      ctx.http().get(`${BASE}/${event.id}`),
      ctx.http().patch(`${BASE}/${event.id}`).send({ title: 'Hijacked title' }),
      ctx.http().post(`${BASE}/${event.id}/submit`),
      ctx.http().post(`${BASE}/${event.id}/archive`),
      ctx
        .http()
        .put(`${BASE}/${event.id}/ticket-types`)
        .send({ ticketTypes: [{ kind: 'VIP', name: 'VIP', priceKobo: 1 }] }),
      ctx.http().post(`${BASE}/${event.id}/videos`).send({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
      ctx.http().post(`${BASE}/${hotel.id}/room-types`).send({ name: 'Suite', priceKobo: 1 }),
      ctx.http().patch(`${BASE}/${hotel.id}/room-types/${roomType.id}`).send({ priceKobo: 1 }),
      ctx.http().get(`${BASE}/${hotel.id}/availability?from=${isoDay(1)}&to=${isoDay(5)}`),
    ];
    for (const [index, call] of calls.entries()) {
      const res = await call.set(intruder.auth);
      expect(res.status, `call ${index}`).toBe(404);
    }
    const res = await ctx
      .http()
      .post(`${BASE}/${event.id}/images`)
      .set(intruder.auth)
      .attach('file', await testImage(), { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(404);
    const list = (await ctx.http().get(BASE).set(intruder.auth).expect(200)).body.data;
    expect(list.items).toEqual([]);
  });

  it('a room cannot use another hotel’s room type', async () => {
    const owner = await createAgent(ctx);
    const a = await create(owner, 'HOTEL');
    const b = await create(owner, 'HOTEL', { title: 'Second hotel by the sea' });
    const foreign = (await addRoomType(owner, b.id)).hotel!.roomTypes[0]!;
    const res = await ctx
      .http()
      .post(`${BASE}/${a.id}/rooms`)
      .set(owner.auth)
      .send({ roomTypeId: foreign.id, label: '101' })
      .expect(422);
    expect(res.body.details.issues[0].path).toBe('roomTypeId');
  });

  it('details of another kind are rejected on update', async () => {
    const agent = await createAgent(ctx);
    const event = await create(agent, 'EVENT');
    await ctx
      .http()
      .patch(`${BASE}/${event.id}`)
      .set(agent.auth)
      .send({ tour: { category: 'ZOO_TOUR' } })
      .expect(422);
    await ctx
      .http()
      .put(`${BASE}/${event.id}/tour-dates`)
      .set(agent.auth)
      .send({ dates: [future(3)] })
      .expect(400);
    await ctx
      .http()
      .post(`${BASE}/${event.id}/room-types`)
      .set(agent.auth)
      .send({ name: 'Suite', priceKobo: 1 })
      .expect(400);
  });
});

describe('plan limits', () => {
  it('the Free plan’s 0 means events, tours and hotels are not included', async () => {
    await setDefaultLimits({ EVENT_COUNT: 0 });
    const agent = await createAgent(ctx);
    const res = await ctx.http().post(BASE).set(agent.auth).send(COMPLETE.EVENT).expect(403);
    expect(res.body).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      details: { entitlement: 'EVENT_COUNT', limit: 0, used: 0, planName: 'Free' },
    });
    expect(res.body.message).toMatch(/Events are not included in your Free plan/);
  });

  it('counts non-archived listings of the same kind; archive frees, restore re-checks', async () => {
    await setDefaultLimits({ TOUR_COUNT: 1, HOTEL_COUNT: 1 });
    const agent = await createAgent(ctx);
    const tour = await create(agent, 'TOUR');
    const blocked = await ctx.http().post(BASE).set(agent.auth).send(COMPLETE.TOUR).expect(403);
    expect(blocked.body.details).toMatchObject({ entitlement: 'TOUR_COUNT', limit: 1, used: 1 });
    expect(blocked.body.message).toMatch(/tour limit/);
    // Other kinds have their own allowance.
    await create(agent, 'HOTEL');

    await ctx.http().post(`${BASE}/${tour.id}/archive`).set(agent.auth).expect(200);
    const second = await create(agent, 'TOUR');
    await ctx.http().post(`${BASE}/${tour.id}/restore`).set(agent.auth).expect(403);
    await ctx.http().post(`${BASE}/${second.id}/archive`).set(agent.auth).expect(200);
    await ctx.http().post(`${BASE}/${tour.id}/restore`).set(agent.auth).expect(200);

    const list = (await ctx.http().get(BASE).set(agent.auth).expect(200)).body.data;
    expect(list.allowances).toEqual({
      EVENT: { used: 0, limit: 5 },
      TOUR: { used: 1, limit: 1 },
      HOTEL: { used: 1, limit: 1 },
      CLEANING: null,
    });
  });

  it('cleaning services are never limited, even when the plan says 0', async () => {
    await setDefaultLimits({ CLEANING_SERVICE_COUNT: 0 });
    const agent = await createAgent(ctx);
    for (let i = 0; i < 3; i++) await create(agent, 'CLEANING');
    expect(await ctx.prisma.experience.count({ where: { kind: 'CLEANING' } })).toBe(3);
  });

  it('parallel creates cannot exceed the allowance', async () => {
    await setDefaultLimits({ EVENT_COUNT: 2 });
    const agent = await createAgent(ctx);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => ctx.http().post(BASE).set(agent.auth).send(COMPLETE.EVENT)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 403)).toHaveLength(4);
    expect(await ctx.prisma.experience.count({ where: { kind: 'EVENT' } })).toBe(2);
  });

  it('subscription usage reports events, tours and hotels; cleaning is not counted', async () => {
    const agent = await createAgent(ctx);
    await create(agent, 'EVENT');
    await create(agent, 'CLEANING');
    const archived = await create(agent, 'TOUR');
    await ctx.http().post(`${BASE}/${archived.id}/archive`).set(agent.auth).expect(200);
    const usage = (
      await ctx.http().get('/api/v1/agents/me/subscription').set(agent.auth).expect(200)
    ).body.data.usage as { key: string; used: number | null; enforced: boolean }[];
    const by = (key: string) => usage.find((u) => u.key === key);
    expect(by('EVENT_COUNT')).toMatchObject({ used: 1, enforced: true });
    expect(by('TOUR_COUNT')).toMatchObject({ used: 0, enforced: true });
    expect(by('HOTEL_COUNT')).toMatchObject({ used: 0, enforced: true });
    expect(by('CLEANING_SERVICE_COUNT')).toMatchObject({ used: null, enforced: false });
  });

  it('listing images count towards the storage allowance', async () => {
    await setDefaultLimits({ STORAGE_MB: 0 });
    const agent = await createAgent(ctx);
    const draft = await create(agent, 'CLEANING');
    const res = await ctx
      .http()
      .post(`${BASE}/${draft.id}/images`)
      .set(agent.auth)
      .attach('file', await testImage(), { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(403);
    expect(res.body.details.entitlement).toBe('STORAGE_MB');
    // Nothing is left behind for a rejected upload.
    expect(await ctx.prisma.experienceImage.count()).toBe(0);
  });
});

describe('lifecycle and moderation', () => {
  it('reports what is missing and refuses to submit incomplete listings', async () => {
    const agent = await createAgent(ctx);
    const res = await ctx
      .http()
      .post(BASE)
      .set(agent.auth)
      .send({ kind: 'HOTEL', title: 'Unfinished hotel' })
      .expect(201);
    expect(res.body.data.missingForSubmission).toEqual(
      expect.arrayContaining([
        'description',
        'city',
        'state',
        'addressLine',
        'roomTypes',
        'images',
      ]),
    );
    const submit = await ctx
      .http()
      .post(`${BASE}/${res.body.data.id}/submit`)
      .set(agent.auth)
      .expect(422);
    expect(submit.body.code).toBe('PROPERTY_INCOMPLETE');

    const cleaning = await create(agent, 'CLEANING', { cleaning: { serviceAreas: [] } });
    expect(cleaning.missingForSubmission).toEqual(['serviceAreas', 'images']);
    const past = await create(agent, 'EVENT', {
      event: { startsAt: future(-3, 10), endsAt: future(-3, 12) },
    });
    expect(past.missingForSubmission).toContain('startsAtInFuture');
  });

  it('an unverified agent can draft but not submit', async () => {
    const agent = await createAgent(ctx, 'PENDING');
    const draft = await create(agent, 'CLEANING');
    await addImage(agent, draft.id);
    const res = await ctx.http().post(`${BASE}/${draft.id}/submit`).set(agent.auth).expect(403);
    expect(res.body.code).toBe('AGENT_NOT_VERIFIED');
  });

  it.each(Object.keys(COMPLETE) as Kind[])(
    'a %s goes draft → review → published, and is then public',
    async (kind) => {
      const agent = await createAgent(ctx);
      const live = await publish(agent, kind);
      expect(live.status).toBe('PUBLISHED');
      const detail = (await publicDetail(live.slug).expect(200)).body.data;
      expect(detail).toMatchObject({ kind, title: live.title, purchasable: false });
      const list = (await ctx.http().get(`/api/v1/experiences?kind=${kind}`).expect(200)).body.data;
      expect(list.items.map((i: { id: string }) => i.id)).toEqual([live.id]);
      // Other kinds' pages never show it.
      const other = kind === 'EVENT' ? 'TOUR' : 'EVENT';
      const none = (await ctx.http().get(`/api/v1/experiences?kind=${other}`).expect(200)).body
        .data;
      expect(none.total).toBe(0);
    },
  );

  it('editing a published listing sends it back to review and hides it', async () => {
    const agent = await createAgent(ctx);
    const live = await publish(agent, 'TOUR');
    const res = await ctx
      .http()
      .patch(`${BASE}/${live.id}`)
      .set(agent.auth)
      .send({ tour: { priceKobo: 2_000_000 } })
      .expect(200);
    expect(res.body.data.status).toBe('PENDING_REVIEW');
    await publicDetail(live.slug).expect(404);
    // The slug of a once-published listing never changes.
    const renamed = await ctx
      .http()
      .post(`${BASE}/${live.id}/withdraw`)
      .set(agent.auth)
      .expect(200);
    expect(renamed.body.data.status).toBe('DRAFT');
    const edited = await ctx
      .http()
      .patch(`${BASE}/${live.id}`)
      .set(agent.auth)
      .send({ title: 'A completely new tour name' })
      .expect(200);
    expect(edited.body.data.slug).toBe(live.slug);
  });

  it('tour dates are availability: changing them keeps a published tour live', async () => {
    const agent = await createAgent(ctx);
    const live = await publish(agent, 'TOUR');
    await ctx
      .http()
      .put(`${BASE}/${live.id}/tour-dates`)
      .set(agent.auth)
      .send({ dates: [future(-2)] })
      .expect(422);
    const res = await ctx
      .http()
      .put(`${BASE}/${live.id}/tour-dates`)
      .set(agent.auth)
      .send({ dates: [future(10), future(3), future(3)] })
      .expect(200);
    expect(res.body.data.status).toBe('PUBLISHED');
    expect(res.body.data.tour.dates).toEqual([future(3), future(10)]);
    // A past date already stored stays as history but is never shown publicly.
    await ctx.prisma.tourDate.create({ data: { tourId: live.id, startsAt: new Date(future(-5)) } });
    await ctx
      .http()
      .put(`${BASE}/${live.id}/tour-dates`)
      .set(agent.auth)
      .send({ dates: [future(7)] })
      .expect(200);
    expect(await ctx.prisma.tourDate.count({ where: { tourId: live.id } })).toBe(2);
    const detail = (await publicDetail(live.slug).expect(200)).body.data;
    expect(detail.tour.dates).toEqual([future(7)]);
    expect(detail.startsAt).toBe(future(7));
  });

  it('ticket types are catalogue definitions; changing them is moderated', async () => {
    const agent = await createAgent(ctx);
    const live = await publish(agent, 'EVENT');
    await ctx
      .http()
      .put(`${BASE}/${live.id}/ticket-types`)
      .set(agent.auth)
      .send({
        ticketTypes: [
          { kind: 'VIP', name: 'VIP', priceKobo: 5_000_000 },
          { kind: 'VIP', name: 'vip', priceKobo: 1 },
        ],
      })
      .expect(422);
    const res = await ctx
      .http()
      .put(`${BASE}/${live.id}/ticket-types`)
      .set(agent.auth)
      .send({
        ticketTypes: [
          { kind: 'EARLY_BIRD', name: 'Early Bird', priceKobo: 800_000 },
          { kind: 'VVIP', name: 'Table for 6', priceKobo: 30_000_000, description: 'Six seats' },
        ],
      })
      .expect(200);
    expect(res.body.data.status).toBe('PENDING_REVIEW');
    expect(res.body.data.event.ticketTypes.map((t: { name: string }) => t.name)).toEqual([
      'Early Bird',
      'Table for 6',
    ]);
    await ctx
      .http()
      .patch(`/api/v1/admin/experiences/${live.id}/moderation`)
      .set(await moderator())
      .send({ action: 'APPROVE' })
      .expect(200);
    const detail = (await publicDetail(live.slug).expect(200)).body.data;
    expect(detail.priceFromKobo).toBe(800_000);
    expect(detail.purchasable).toBe(false);
  });

  it('there is no purchase, ticket or booking endpoint', async () => {
    const agent = await createAgent(ctx);
    const live = await publish(agent, 'EVENT');
    const c = await customer(ctx);
    for (const path of [
      `/api/v1/experiences/${live.slug}/tickets`,
      `/api/v1/experiences/${live.id}/purchase`,
      `/api/v1/experiences/${live.id}/bookings`,
    ]) {
      await ctx.http().post(path).set(c.auth).send({}).expect(404);
    }
  });

  it('moderation needs the permission, a reason to reject, and is audited', async () => {
    const agent = await createAgent(ctx);
    const draft = await create(agent, 'CLEANING');
    await addImage(agent, draft.id);
    await ctx.http().post(`${BASE}/${draft.id}/submit`).set(agent.auth).expect(200);
    const url = `/api/v1/admin/experiences/${draft.id}/moderation`;

    for (const role of ['content_manager', 'support_admin', 'finance_admin']) {
      const a = await adminAuth(ctx, [role]);
      await ctx.http().patch(url).set(a.auth).send({ action: 'APPROVE' }).expect(403);
    }
    await ctx.http().get('/api/v1/admin/experiences').set(agent.auth).expect(403);

    const ops = (await adminAuth(ctx, ['operations_manager'])).auth;
    await ctx.http().patch(url).set(ops).send({ action: 'REJECT' }).expect(422);
    const rejected = await ctx
      .http()
      .patch(url)
      .set(ops)
      .send({ action: 'REJECT', note: 'Please add clearer photos.' })
      .expect(200);
    expect(rejected.body.data).toMatchObject({
      status: 'REJECTED',
      moderationNote: 'Please add clearer photos.',
    });
    await ctx.http().patch(url).set(ops).send({ action: 'APPROVE' }).expect(409);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'experience.moderation.reject', resourceId: draft.id },
    });
    expect(audit).not.toBeNull();

    const queue = (
      await ctx.http().get('/api/v1/admin/experiences?kind=CLEANING').set(ops).expect(200)
    ).body.data;
    expect(queue.items[0]).toMatchObject({ id: draft.id, kind: 'CLEANING', status: 'REJECTED' });
  });

  it('suspension and restricted agents hide listings publicly', async () => {
    const agent = await createAgent(ctx);
    const live = await publish(agent, 'HOTEL');
    const mod = await moderator();
    await ctx
      .http()
      .patch(`/api/v1/admin/experiences/${live.id}/moderation`)
      .set(mod)
      .send({ action: 'SUSPEND', note: 'Reported' })
      .expect(200);
    await publicDetail(live.slug).expect(404);
    await ctx.http().post(`${BASE}/${live.id}/archive`).set(agent.auth).expect(409);
    await ctx
      .http()
      .patch(`/api/v1/admin/experiences/${live.id}/moderation`)
      .set(mod)
      .send({ action: 'RESTORE' })
      .expect(200);
    await publicDetail(live.slug).expect(200);

    await ctx.prisma.agentProfile.update({
      where: { id: agent.agentProfileId },
      data: { verificationStatus: 'SUSPENDED' },
    });
    await publicDetail(live.slug).expect(404);
    expect(
      (await ctx.http().get('/api/v1/experiences?kind=HOTEL').expect(200)).body.data.total,
    ).toBe(0);
  });

  it('drafts are never public, and malformed slugs answer 404', async () => {
    const agent = await createAgent(ctx);
    const draft = await create(agent, 'EVENT');
    await publicDetail(draft.slug).expect(404);
    await publicDetail('../../etc/passwd').expect(404);
    await publicDetail('a'.repeat(400)).expect(404);
    await ctx.http().get('/api/v1/experiences?kind=PARTY').expect(422);
    await ctx.http().get('/api/v1/experiences').expect(422);
  });

  it('past events move to the past list', async () => {
    const agent = await createAgent(ctx);
    const live = await publish(agent, 'EVENT');
    await ctx.prisma.event.update({
      where: { experienceId: live.id },
      data: { startsAt: new Date(future(-2, 10)), endsAt: new Date(future(-2, 12)) },
    });
    const upcoming = (await ctx.http().get('/api/v1/experiences?kind=EVENT').expect(200)).body.data;
    expect(upcoming.total).toBe(0);
    const past = (await ctx.http().get('/api/v1/experiences?kind=EVENT&when=past').expect(200)).body
      .data;
    expect(past.items[0].id).toBe(live.id);
    await publicDetail(live.slug).expect(200);
  });
});

describe('hotel rooms and availability', () => {
  it('manages room types and rooms with their own prices', async () => {
    const agent = await createAgent(ctx);
    const hotel = await create(agent, 'HOTEL');
    const deluxe = (await addRoomType(agent, hotel.id, 'Deluxe', 4_500_000)).hotel!.roomTypes[0]!;
    await ctx
      .http()
      .post(`${BASE}/${hotel.id}/room-types`)
      .set(agent.auth)
      .send({ name: 'deluxe', priceKobo: 1 })
      .expect(422);
    const room = async (label: string, priceKobo?: number) =>
      (
        await ctx
          .http()
          .post(`${BASE}/${hotel.id}/rooms`)
          .set(agent.auth)
          .send({ roomTypeId: deluxe.id, label, ...(priceKobo ? { priceKobo } : {}) })
          .expect(201)
      ).body.data as AgentExperienceView;
    await room('101');
    const view = await room('102', 5_000_000);
    await ctx
      .http()
      .post(`${BASE}/${hotel.id}/rooms`)
      .set(agent.auth)
      .send({ roomTypeId: deluxe.id, label: '101' })
      .expect(422);
    expect(view.hotel!.rooms.map((r) => r.label)).toEqual(['101', '102']);
    expect(view.hotel!.roomTypes[0]!.roomCount).toBe(2);
    // A type with rooms cannot be deleted.
    await ctx
      .http()
      .delete(`${BASE}/${hotel.id}/room-types/${deluxe.id}`)
      .set(agent.auth)
      .expect(409);
  });

  it('per-room, per-date availability is catalogue data; public sees totals only', async () => {
    const agent = await createAgent(ctx);
    const live = await publish(agent, 'HOTEL');
    const type = live.hotel!.roomTypes[0]!;
    const rooms: { id: string; label: string }[] = [];
    for (const label of ['101', '102']) {
      const res = await ctx
        .http()
        .post(`${BASE}/${live.id}/rooms`)
        .set(agent.auth)
        .send({ roomTypeId: type.id, label })
        .expect(201);
      expect(res.body.data.status).toBe('PUBLISHED');
      rooms.push(res.body.data.hotel.rooms.find((r: { label: string }) => r.label === label));
    }
    const day1 = isoDay(3);
    const day2 = isoDay(4);
    const set = await ctx
      .http()
      .put(`${BASE}/${live.id}/rooms/${rooms[0]!.id}/availability`)
      .set(agent.auth)
      .send({
        set: [
          { date: day1, available: false },
          { date: day2, available: true, priceKobo: 3_000_000 },
        ],
      })
      .expect(200);
    expect(set.body.data.status).toBe('PUBLISHED');
    await ctx
      .http()
      .put(`${BASE}/${live.id}/rooms/${rooms[0]!.id}/availability`)
      .set(agent.auth)
      .send({ set: [{ date: isoDay(-1), available: false }] })
      .expect(422);
    await ctx
      .http()
      .put(`${BASE}/${live.id}/rooms/${rooms[0]!.id}/availability`)
      .set(agent.auth)
      .send({ set: [{ date: day1, available: true }], clear: [day1] })
      .expect(422);

    const owner = (
      await ctx
        .http()
        .get(`${BASE}/${live.id}/availability?from=${day1}&to=${day2}`)
        .set(agent.auth)
        .expect(200)
    ).body.data;
    expect(
      owner.rooms.find((r: { roomId: string }) => r.roomId === rooms[0]!.id).overrides,
    ).toEqual([
      { date: day1, available: false, priceKobo: null },
      { date: day2, available: true, priceKobo: 3_000_000 },
    ]);

    const pub = (
      await ctx
        .http()
        .get(`/api/v1/experiences/${live.slug}/availability?from=${day1}&to=${day2}`)
        .expect(200)
    ).body.data;
    expect(pub.roomTypes[0].days).toEqual([
      { date: day1, availableRooms: 1, minPriceKobo: 4_500_000 },
      { date: day2, availableRooms: 2, minPriceKobo: 3_000_000 },
    ]);
    expect(JSON.stringify(pub)).not.toContain('101');

    await ctx
      .http()
      .put(`${BASE}/${live.id}/rooms/${rooms[0]!.id}/availability`)
      .set(agent.auth)
      .send({ clear: [day1] })
      .expect(200);
    expect(await ctx.prisma.hotelRoomAvailability.count()).toBe(1);
    await ctx
      .http()
      .get(`/api/v1/experiences/${live.slug}/availability?from=${day1}&to=${isoDay(200)}`)
      .expect(422);
  });

  it('a published hotel keeps at least one room type', async () => {
    const agent = await createAgent(ctx);
    const live = await publish(agent, 'HOTEL');
    await ctx
      .http()
      .delete(`${BASE}/${live.id}/room-types/${live.hotel!.roomTypes[0]!.id}`)
      .set(agent.auth)
      .expect(409);
  });
});

describe('media', () => {
  it('re-encodes images and rejects non-images', async () => {
    const agent = await createAgent(ctx);
    const draft = await create(agent, 'TOUR');
    const view = await addImage(agent, draft.id);
    expect(view.images[0]).toMatchObject({ isPrimary: true });
    expect(view.images[0]!.url).toMatch(/\/experiences\/[0-9a-f-]+\/[0-9a-f-]+-lg\.webp$/);
    const res = await ctx
      .http()
      .post(`${BASE}/${draft.id}/images`)
      .set(agent.auth)
      .attach('file', Buffer.from('<svg onload=alert(1)>'), {
        filename: 'x.jpg',
        contentType: 'image/jpeg',
      });
    expect(res.status).toBe(422);
  });

  it('accepts YouTube/Vimeo links only', async () => {
    const agent = await createAgent(ctx);
    const draft = await create(agent, 'TOUR');
    await ctx
      .http()
      .post(`${BASE}/${draft.id}/videos`)
      .set(agent.auth)
      .send({ url: 'https://evil.example.com/video.mp4' })
      .expect(422);
    const ok = await ctx
      .http()
      .post(`${BASE}/${draft.id}/videos`)
      .set(agent.auth)
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
      .expect(201);
    expect(ok.body.data.videos[0]).toMatchObject({
      provider: 'YOUTUBE',
      externalId: 'dQw4w9WgXcQ',
    });
  });
});

describe('vacation zones', () => {
  const ZONES = '/api/v1/admin/vacation-zones';

  it('only zone managers manage them; drafts stay private', async () => {
    for (const role of ['support_admin', 'finance_admin', 'operations_manager']) {
      const a = await adminAuth(ctx, [role]);
      await ctx.http().post(ZONES).set(a.auth).send({ name: 'Obudu' }).expect(403);
    }
    const agent = await createAgent(ctx);
    await ctx.http().get(ZONES).set(agent.auth).expect(403);

    const content = (await adminAuth(ctx, ['content_manager'])).auth;
    const zone = (
      await ctx
        .http()
        .post(ZONES)
        .set(content)
        .send({
          name: 'Obudu Mountain Resort',
          state: 'Cross River',
          description: 'Cool highland air, cable cars and waterfalls.',
          priceRangeMinKobo: 2_000_000,
          priceRangeMaxKobo: 15_000_000,
          activities: ['Cable car', 'Hiking', 'hiking'],
          nearbyAttractions: ['Becheve Nature Reserve'],
        })
        .expect(201)
    ).body.data;
    expect(zone).toMatchObject({ published: false, activities: ['Cable car', 'Hiking'] });
    expect(zone.slug).toMatch(/^obudu-mountain-resort-[0-9a-f]{6}$/);
    await ctx.http().get(`/api/v1/vacation-zones/${zone.slug}`).expect(404);

    await ctx
      .http()
      .patch(`${ZONES}/${zone.id}`)
      .set(content)
      .send({ priceRangeMinKobo: 20_000_000 })
      .expect(422);
    await ctx
      .http()
      .patch(`${ZONES}/${zone.id}`)
      .set(content)
      .send({ published: true })
      .expect(200);
    const pub = (await ctx.http().get(`/api/v1/vacation-zones/${zone.slug}`).expect(200)).body.data;
    expect(pub).toMatchObject({ name: 'Obudu Mountain Resort', experiences: [] });
    expect(pub).not.toHaveProperty('published');
    const list = (await ctx.http().get('/api/v1/vacation-zones').expect(200)).body.data;
    expect(list.items).toHaveLength(1);
    expect(
      await ctx.prisma.auditLog.count({
        where: { resourceType: 'vacation_zone', resourceId: zone.id },
      }),
    ).toBe(2);
  });

  it('features published tours and hotels only, and hides them when they go private', async () => {
    const agent = await createAgent(ctx);
    const tour = await publish(agent, 'TOUR');
    const event = await publish(agent, 'EVENT');
    const draftHotel = await create(agent, 'HOTEL');
    const content = (await adminAuth(ctx, ['content_manager'])).auth;
    const zone = (
      await ctx.http().post(ZONES).set(content).send({ name: 'Lagos Island', published: true })
    ).body.data;
    for (const ids of [[event.id], [draftHotel.id], [tour.id, tour.id]]) {
      await ctx
        .http()
        .put(`${ZONES}/${zone.id}/experiences`)
        .set(content)
        .send({ experienceIds: ids })
        .expect(422);
    }
    const set = await ctx
      .http()
      .put(`${ZONES}/${zone.id}/experiences`)
      .set(content)
      .send({ experienceIds: [tour.id] })
      .expect(200);
    expect(set.body.data.experiences).toEqual([
      expect.objectContaining({ id: tour.id, public: true }),
    ]);
    let pub = (await ctx.http().get(`/api/v1/vacation-zones/${zone.slug}`).expect(200)).body.data;
    expect(pub.experiences.map((e: { id: string }) => e.id)).toEqual([tour.id]);

    await ctx
      .http()
      .patch(`/api/v1/admin/experiences/${tour.id}/moderation`)
      .set(await moderator())
      .send({ action: 'SUSPEND', note: 'Check' })
      .expect(200);
    pub = (await ctx.http().get(`/api/v1/vacation-zones/${zone.slug}`).expect(200)).body.data;
    expect(pub.experiences).toEqual([]);
    const admin = (await ctx.http().get(`${ZONES}/${zone.id}`).set(content).expect(200)).body.data;
    expect(admin.experiences[0]).toMatchObject({ id: tour.id, public: false });
  });

  it('takes a cover image and deletes zones (audited)', async () => {
    const content = (await adminAuth(ctx, ['content_manager'])).auth;
    const zone = (await ctx.http().post(ZONES).set(content).send({ name: 'Yankari' })).body.data;
    const res = await ctx
      .http()
      .post(`${ZONES}/${zone.id}/cover`)
      .set(content)
      .attach('file', await testImage(), { filename: 'c.jpg', contentType: 'image/jpeg' })
      .expect(201);
    expect(res.body.data.coverImage.url).toMatch(/\/zones\/[0-9a-f-]+\/[0-9a-f-]+-lg\.webp$/);
    await ctx.http().delete(`${ZONES}/${zone.id}`).set(content).expect(200);
    await ctx.http().get(`${ZONES}/${zone.id}`).set(content).expect(404);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'vacation_zone.deleted' } })).toBe(1);
  });
});

describe('messaging about a listing', () => {
  it('a customer messages the agent about a public listing (get-or-create)', async () => {
    const agent = await createAgent(ctx);
    const live = await publish(agent, 'CLEANING');
    const draft = await create(agent, 'TOUR');
    const c = await customer(ctx);
    const start = () =>
      ctx
        .http()
        .post('/api/v1/conversations')
        .set(c.auth)
        .send({ contextType: 'EXPERIENCE', experienceId: live.id });
    const [a, b] = await Promise.all([start(), start()]);
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(a.body.data.context).toMatchObject({
      type: 'EXPERIENCE',
      experience: { id: live.id, kind: 'CLEANING', slug: live.slug },
    });

    await ctx
      .http()
      .post('/api/v1/conversations')
      .set(c.auth)
      .send({ contextType: 'EXPERIENCE', experienceId: draft.id })
      .expect(404);
    await ctx
      .http()
      .post('/api/v1/conversations')
      .set(agent.auth)
      .send({ contextType: 'EXPERIENCE', experienceId: live.id })
      .expect(403);
    // The database refuses a context that does not match its type.
    await expect(
      ctx.prisma.$executeRawUnsafe(
        `UPDATE conversations SET property_id = NULL, experience_id = NULL WHERE id = '${a.body.data.id}'`,
      ),
    ).rejects.toThrow(/conversations_context_check/);
  });
});
