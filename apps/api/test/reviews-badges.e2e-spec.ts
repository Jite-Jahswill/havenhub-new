import type {
  AdminBadgeDetail,
  CustomerBookingDetail,
  NotificationPage,
  PropertyCard,
  PropertyReviewsPage,
} from '@havenhub/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BookingMaintenanceService } from '../src/modules/bookings/booking-maintenance.service';
import {
  adminAuth,
  book,
  customer,
  inDays,
  payWithTestProvider,
  rental,
  setPricing,
  type Customer,
} from './helpers/booking-helpers';
import { createTestContext, testImage, type TestContext } from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

/** A paid stay that has ended and been completed by the booking sweep. */
async function completedStay(property: { id: string }, who?: Customer) {
  const c = who ?? (await customer(ctx));
  const b = await book(ctx, c, { propertyId: property.id, startDate: inDays(10), quantity: 1 });
  await payWithTestProvider(ctx, c, b.id);
  // Move the stay into the past, then let the sweep complete it.
  const days = await ctx.prisma.booking.count({ where: { propertyId: property.id } });
  await ctx.prisma.booking.update({
    where: { id: b.id },
    data: {
      startDate: new Date(`${inDays(-10 - days * 3)}T00:00:00Z`),
      endDate: new Date(`${inDays(-9 - days * 3)}T00:00:00Z`),
    },
  });
  await ctx.app.get(BookingMaintenanceService).runOnce();
  return { customer: c, booking: b };
}

const review = (who: Customer, bookingId: string, body: Record<string, unknown>) =>
  ctx.http().post(`/api/v1/bookings/${bookingId}/review`).set(who.auth).send(body);

async function card(slug: string) {
  const res = await ctx.http().get('/api/v1/properties').expect(200);
  return (res.body.data.items as PropertyCard[]).find((p) => p.slug === slug)!;
}

describe('reviews', () => {
  it('only after a completed stay, once, by its customer; stars update at once', async () => {
    await setPricing(ctx);
    const { agent, property } = await rental(ctx);
    const c = await customer(ctx);

    // Not before the stay is completed.
    const early = await book(ctx, c, {
      propertyId: property.id,
      startDate: inDays(30),
      quantity: 1,
    });
    await review(c, early.id, { rating: 5 }).expect(409);

    const { booking } = await completedStay(property, c);
    const before = (await ctx.http().get(`/api/v1/bookings/${booking.id}`).set(c.auth).expect(200))
      .body.data as CustomerBookingDetail;
    expect(before).toMatchObject({ canReview: true, review: null });
    expect(before.reviewBy).toBeTruthy();

    const other = await customer(ctx);
    await review(other, booking.id, { rating: 1 }).expect(404);
    await review(c, booking.id, { rating: 6 }).expect(422);
    const res = await review(c, booking.id, { rating: 4, comment: 'Clean and quiet.' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ canReview: false, review: { rating: 4 } });
    await review(c, booking.id, { rating: 5 }).expect(409);

    expect((await card(property.slug)).rating).toEqual({ average: 4, count: 1 });
    const page = (await ctx.http().get(`/api/v1/properties/${property.slug}/reviews`).expect(200))
      .body.data as PropertyReviewsPage;
    expect(page.rating).toEqual({ average: 4, count: 1 });
    expect(page.items[0]).toMatchObject({
      rating: 4,
      comment: 'Clean and quiet.',
      authorName: 'Chiamaka O.',
    });
    expect(page.items[0]).not.toHaveProperty('customerId');

    // The agent is told.
    const inbox = (await ctx.http().get('/api/v1/notifications').set(agent.auth).expect(200)).body
      .data as NotificationPage;
    expect(
      inbox.items.some((n) => n.type === 'REVIEW_RECEIVED' && n.title === 'New 4-star review'),
    ).toBe(true);
  });

  it('follow the reviews policy: window after check-out, and on/off', async () => {
    await setPricing(ctx);
    const { property } = await rental(ctx);
    const { customer: c, booking } = await completedStay(property);
    await ctx.prisma.booking.update({
      where: { id: booking.id },
      data: { completedAt: new Date(Date.now() - 61 * 24 * 3600 * 1000) },
    });
    expect((await review(c, booking.id, { rating: 5 }).expect(409)).body.message).toMatch(
      /60 days/,
    );

    const admin = (await adminAuth(ctx, ['super_admin'])).auth;
    await ctx
      .http()
      .patch('/api/v1/admin/settings/policies')
      .set(admin)
      .send({ reviews: { windowDays: 90, enabled: false } })
      .expect(200);
    expect((await review(c, booking.id, { rating: 5 }).expect(403)).body.code).toBe(
      'FEATURE_DISABLED',
    );
    await ctx
      .http()
      .patch('/api/v1/admin/settings/policies')
      .set(admin)
      .send({ reviews: { enabled: true } })
      .expect(200);
    await review(c, booking.id, { rating: 5 }).expect(201);
  });

  it('can be hidden by moderators (then they stop counting) and restored', async () => {
    await setPricing(ctx);
    const { property } = await rental(ctx);
    const { customer: c, booking } = await completedStay(property);
    await review(c, booking.id, { rating: 1, comment: 'Abusive text' }).expect(201);
    const reviewId = (await ctx.prisma.review.findFirstOrThrow()).id;

    const finance = await adminAuth(ctx, ['finance_admin']);
    await ctx.http().get('/api/v1/admin/reviews').set(finance.auth).expect(403);
    const mod = await adminAuth(ctx, ['property_manager']);
    await ctx
      .http()
      .post(`/api/v1/admin/reviews/${reviewId}/hide`)
      .set(mod.auth)
      .send({})
      .expect(422);
    await ctx
      .http()
      .post(`/api/v1/admin/reviews/${reviewId}/hide`)
      .set(mod.auth)
      .send({ reason: 'Abusive language' })
      .expect(200);
    expect((await card(property.slug)).rating).toBeNull();
    const page = (await ctx.http().get(`/api/v1/properties/${property.slug}/reviews`).expect(200))
      .body.data as PropertyReviewsPage;
    expect(page.total).toBe(0);
    const list = await ctx
      .http()
      .get('/api/v1/admin/reviews?status=HIDDEN')
      .set(mod.auth)
      .expect(200);
    expect(list.body.data.items[0]).toMatchObject({
      hiddenReason: 'Abusive language',
      bookingReference: booking.reference,
    });

    await ctx.http().post(`/api/v1/admin/reviews/${reviewId}/restore`).set(mod.auth).expect(200);
    expect((await card(property.slug)).rating).toEqual({ average: 1, count: 1 });
    const actions = (await ctx.prisma.auditLog.findMany({ where: { resourceType: 'review' } })).map(
      (a) => a.action,
    );
    expect(actions.sort()).toEqual(['review.created', 'review.hidden', 'review.restored']);
  });
});

describe('badges', () => {
  let admin: Record<string, string>;
  beforeEach(async () => {
    admin = (await adminAuth(ctx, ['super_admin'])).auth;
  });

  async function badgeImage() {
    const res = await ctx
      .http()
      .post('/api/v1/admin/cms/media')
      .set(admin)
      .attach('file', await testImage(400, 400), {
        filename: 'badge.png',
        contentType: 'image/png',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  async function createBadge(body: Record<string, unknown>, expected = 201) {
    const res = await ctx.http().post('/api/v1/admin/badges').set(admin).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(expected);
    return res.body.data as AdminBadgeDetail;
  }

  it('"award winning": earned automatically by 5 stars and enough stays, lost when that stops', async () => {
    await setPricing(ctx);
    const { property } = await rental(ctx);
    const imageId = await badgeImage();
    const award = await createBadge({
      name: 'Award winning',
      description: '5 stars from guests and popular',
      imageId,
      mode: 'AUTOMATIC',
      minRating: 5,
      minCompletedBookings: 2,
    });
    expect(award.holders).toBe(0);

    const first = await completedStay(property);
    await review(first.customer, first.booking.id, { rating: 5 }).expect(201);
    // One stay is not enough yet.
    expect((await card(property.slug)).badges).toEqual([]);

    const second = await completedStay(property);
    await review(second.customer, second.booking.id, { rating: 5 }).expect(201);
    const earned = (await card(property.slug)).badges;
    expect(earned).toEqual([
      {
        id: award.id,
        name: 'Award winning',
        description: '5 stars from guests and popular',
        imageUrl: expect.any(String) as string,
      },
    ]);
    // The property page shows it too.
    const detail = await ctx.http().get(`/api/v1/properties/${property.slug}`).expect(200);
    expect(detail.body.data.badges).toHaveLength(1);
    expect(detail.body.data.rating).toEqual({ average: 5, count: 2 });

    // A 4-star review brings the average below 5: the badge goes.
    const third = await completedStay(property);
    await review(third.customer, third.booking.id, { rating: 4 }).expect(201);
    expect((await card(property.slug)).badges).toEqual([]);

    // Relaxing the rule gives it back at once.
    await ctx
      .http()
      .patch(`/api/v1/admin/badges/${award.id}`)
      .set(admin)
      .send({ minRating: 4.6 })
      .expect(200);
    expect((await card(property.slug)).badges).toHaveLength(1);

    // Switched off: no longer shown anywhere (the award is kept).
    await ctx
      .http()
      .patch(`/api/v1/admin/badges/${award.id}`)
      .set(admin)
      .send({ active: false })
      .expect(200);
    expect((await card(property.slug)).badges).toEqual([]);
  });

  it('can be given by hand to a property, and taken back', async () => {
    await setPricing(ctx);
    const { property } = await rental(ctx);
    const badge = await createBadge({
      name: 'Editor’s pick',
      imageId: await badgeImage(),
      mode: 'MANUAL',
    });
    await ctx
      .http()
      .post(`/api/v1/admin/badges/${badge.id}/properties`)
      .set(admin)
      .send({ property: `https://havenhub.ng/properties/${property.slug}` })
      .expect(201);
    expect((await card(property.slug)).badges.map((b) => b.name)).toEqual(['Editor’s pick']);
    const detail = (await ctx.http().get(`/api/v1/admin/badges/${badge.id}`).set(admin).expect(200))
      .body.data as AdminBadgeDetail;
    expect(detail.properties[0]).toMatchObject({ slug: property.slug, source: 'MANUAL' });

    await ctx
      .http()
      .delete(`/api/v1/admin/badges/${badge.id}/properties/${property.id}`)
      .set(admin)
      .expect(200);
    expect((await card(property.slug)).badges).toEqual([]);
    await ctx
      .http()
      .post(`/api/v1/admin/badges/${badge.id}/properties`)
      .set(admin)
      .send({ property: 'no-such-place' })
      .expect(422);
  });

  it('show on the "Award-winning properties" homepage section', async () => {
    await setPricing(ctx);
    const { property } = await rental(ctx);
    const badge = await createBadge({
      name: 'Top host',
      imageId: await badgeImage(),
      mode: 'MANUAL',
    });
    await ctx
      .http()
      .post(`/api/v1/admin/badges/${badge.id}/properties`)
      .set(admin)
      .send({ property: property.slug })
      .expect(201);
    await ctx
      .http()
      .patch('/api/v1/admin/cms/homepage/AWARDS')
      .set(admin)
      .send({ enabled: true, config: { limit: 6, badgeId: badge.id } })
      .expect(200);
    const home = (await ctx.http().get('/api/v1/homepage').expect(200)).body.data as {
      key: string;
      properties?: PropertyCard[];
    }[];
    const awards = home.find((s) => s.key === 'AWARDS');
    expect(awards!.properties!.map((p) => p.slug)).toEqual([property.slug]);
  });

  it('validate, need badges.manage, protect their image, and are audited', async () => {
    const imageId = await badgeImage();
    await createBadge({ name: 'Rule-less', imageId, mode: 'AUTOMATIC' }, 422);
    await createBadge(
      { name: 'No image', imageId: '0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', mode: 'MANUAL' },
      422,
    );
    const badge = await createBadge({ name: 'Verified stay', imageId, mode: 'MANUAL' });

    const support = await adminAuth(ctx, ['support_admin']);
    await ctx.http().get('/api/v1/admin/badges').set(support.auth).expect(403);
    const content = await adminAuth(ctx, ['content_manager']);
    await ctx.http().get('/api/v1/admin/badges').set(content.auth).expect(200);

    const blocked = await ctx
      .http()
      .delete(`/api/v1/admin/cms/media/${imageId}`)
      .set(admin)
      .expect(409);
    expect(blocked.body.message).toContain('badges');

    await ctx.http().delete(`/api/v1/admin/badges/${badge.id}`).set(admin).expect(200);
    const actions = (await ctx.prisma.auditLog.findMany({ where: { resourceType: 'badge' } })).map(
      (a) => a.action,
    );
    expect(actions.sort()).toEqual(['badge.created', 'badge.deleted']);
  });
});
