import type { NotificationPage, NotificationView } from '@havenhub/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { BookingMaintenanceService } from '../src/modules/bookings/booking-maintenance.service';
import { NotificationsMaintenanceService } from '../src/modules/notifications/notifications-maintenance.service';
import {
  NOTIFICATIONS_CHANGED,
  NotificationsService,
} from '../src/modules/notifications/notifications.service';
import { RealtimeGateway } from '../src/modules/realtime/realtime.gateway';
import {
  adminAuth,
  book,
  customer,
  inDays,
  payWithTestProvider,
  rental,
  setPricing,
} from './helpers/booking-helpers';
import {
  createAgent,
  createDraft,
  createTestContext,
  moderatorAuth,
  uploadImage,
  type TestContext,
} from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

type Who = { auth: Record<string, string> };

async function inbox(who: Who, query = '') {
  const res = await ctx.http().get(`/api/v1/notifications${query}`).set(who.auth).expect(200);
  return res.body.data as NotificationPage;
}

const types = (page: NotificationPage) => page.items.map((n) => n.type);

/** A paid (confirmed) booking. */
async function paidBooking() {
  await setPricing(ctx);
  const { agent, property } = await rental(ctx);
  const c = await customer(ctx);
  const b = await book(ctx, c, { propertyId: property.id, startDate: inDays(10), quantity: 2 });
  await payWithTestProvider(ctx, c, b.id);
  return { agent, customer: c, booking: b, property };
}

/** Polls until `check` passes (the push happens shortly after commit). */
async function eventually(check: () => void, timeoutMs = 3000) {
  const start = Date.now();
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() - start > timeoutMs) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

describe('inbox', () => {
  it('tells both sides about a confirmed booking, with links to their own dashboards', async () => {
    const { agent, customer: c, booking } = await paidBooking();

    const mine = await inbox(c);
    expect(mine.unread).toBe(1);
    expect(mine.items[0]).toMatchObject({
      type: 'BOOKING_CONFIRMED',
      title: 'Booking confirmed',
      link: `/account/bookings/${booking.id}`,
      read: false,
    });
    expect(mine.items[0]!.body).toContain(booking.reference);

    const theirs = await inbox(agent);
    expect(theirs.items[0]).toMatchObject({
      type: 'BOOKING_RECEIVED',
      link: `/agent/bookings/${booking.id}`,
    });
  });

  it('marks read (own notifications only), reads all, and filters unread', async () => {
    const { agent, customer: c } = await paidBooking();
    const other = await customer(ctx);
    const [first] = (await inbox(c)).items as [NotificationView];

    await ctx.http().post(`/api/v1/notifications/${first.id}/read`).set(other.auth).expect(404);
    await ctx.http().post(`/api/v1/notifications/${first.id}/read`).set(agent.auth).expect(404);
    const read = await ctx
      .http()
      .post(`/api/v1/notifications/${first.id}/read`)
      .set(c.auth)
      .expect(200);
    expect(read.body.data.read).toBe(true);
    expect(
      (await ctx.http().get('/api/v1/notifications/unread').set(c.auth).expect(200)).body.data,
    ).toEqual({ unread: 0 });
    expect((await inbox(c, '?unread=true')).total).toBe(0);
    expect((await inbox(c)).total).toBe(1);

    // The agent has "Listing approved" (from publishing) and "New booking".
    expect(types(await inbox(agent))).toEqual(['BOOKING_RECEIVED', 'LISTING_MODERATED']);
    expect((await inbox(agent)).unread).toBe(2);
    const all = await ctx.http().post('/api/v1/notifications/read-all').set(agent.auth).expect(200);
    expect(all.body.data).toEqual({ updated: 2 });
    expect((await inbox(agent)).unread).toBe(0);
  });

  it('needs a signed-in user', async () => {
    await ctx.http().get('/api/v1/notifications').expect(401);
    await ctx.http().get('/api/v1/notifications/unread').expect(401);
  });
});

describe('events', () => {
  it('cancellation tells the other side; refund approval and completion tell the customer', async () => {
    const { agent, customer: c, booking } = await paidBooking();
    await ctx.http().post(`/api/v1/bookings/${booking.id}/cancel`).set(c.auth).send({}).expect(200);

    expect(types(await inbox(agent))).toContain('BOOKING_CANCELLED');
    // The customer cancelled: they are not told about their own action.
    expect(types(await inbox(c))).not.toContain('BOOKING_CANCELLED');

    const finance = await adminAuth(ctx, ['finance_admin']);
    const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { bookingId: booking.id } });
    await ctx
      .http()
      .post(`/api/v1/admin/refunds/${refund.id}/review`)
      .set(finance.auth)
      .send({ action: 'APPROVE' })
      .expect(200);
    const after = await inbox(c);
    expect(types(after)).toEqual(
      expect.arrayContaining(['REFUND_APPROVED', 'REFUND_COMPLETED', 'BOOKING_CONFIRMED']),
    );
    expect(after.items.find((n) => n.type === 'REFUND_COMPLETED')!.body).toMatch(/₦/);
  });

  it('a rejected refund tells the customer the reason', async () => {
    const { agent, customer: c, booking } = await paidBooking();
    await ctx
      .http()
      .post(`/api/v1/agents/me/bookings/${booking.id}/cancel`)
      .set(agent.auth)
      .send({})
      .expect(200);
    // The agent cancelled: the customer is told.
    expect(types(await inbox(c))).toContain('BOOKING_CANCELLED');

    const finance = await adminAuth(ctx, ['finance_admin']);
    const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { bookingId: booking.id } });
    await ctx
      .http()
      .post(`/api/v1/admin/refunds/${refund.id}/review`)
      .set(finance.auth)
      .send({ action: 'REJECT', note: 'Paid in cash at the property' })
      .expect(200);
    const rejected = (await inbox(c)).items.find((n) => n.type === 'REFUND_REJECTED')!;
    expect(rejected.body).toContain('Paid in cash at the property');
  });

  it('an expired hold tells the customer', async () => {
    await setPricing(ctx);
    const { property } = await rental(ctx);
    const c = await customer(ctx);
    const b = await book(ctx, c, { propertyId: property.id, startDate: inDays(10), quantity: 1 });
    await ctx.prisma.booking.update({
      where: { id: b.id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });
    await ctx.app.get(BookingMaintenanceService).runOnce();
    expect(types(await inbox(c))).toEqual(['BOOKING_EXPIRED']);
  });

  it('moderation and agent status changes tell the agent', async () => {
    const agent = await createAgent(ctx);
    const draft = await createDraft(ctx, agent);
    await uploadImage(ctx, agent, draft.id);
    await ctx
      .http()
      .post(`/api/v1/agents/me/properties/${draft.id}/submit`)
      .set(agent.auth)
      .expect(200);
    await ctx
      .http()
      .patch(`/api/v1/admin/properties/${draft.id}/moderation`)
      .set(await moderatorAuth(ctx))
      .send({ action: 'REJECT', note: 'Add photos of the kitchen' })
      .expect(200);
    const moderated = (await inbox(agent)).items[0]!;
    expect(moderated).toMatchObject({
      type: 'LISTING_MODERATED',
      title: 'Listing not approved',
      link: `/agent/properties/${draft.id}`,
    });
    expect(moderated.body).toContain('Add photos of the kitchen');

    const admin = await adminAuth(ctx, ['super_admin']);
    await ctx
      .http()
      .patch(`/api/v1/admin/agents/${agent.agentProfileId}/verification`)
      .set(admin.auth)
      .send({ status: 'SUSPENDED', note: 'Documents expired' })
      .expect(200);
    expect((await inbox(agent)).items[0]).toMatchObject({
      type: 'AGENT_VERIFICATION',
      title: 'Agent account suspended',
      link: '/agent/profile',
    });
  });
});

describe('delivery', () => {
  it('pushes only after the change commits, and never for a rolled-back change', async () => {
    const gateway = ctx.app.get(RealtimeGateway);
    const spy = vi.spyOn(gateway, 'emitToUser');
    const notifications = ctx.app.get(NotificationsService);
    const c = await customer(ctx);
    const entry = {
      userId: c.id,
      type: 'ANNOUNCEMENT' as const,
      title: 'Hello',
      body: 'Test',
      link: '/properties',
    };
    try {
      await expect(
        ctx.prisma.$transaction(async (tx) => {
          await notifications.notify(tx, [entry]);
          throw new Error('roll back');
        }),
      ).rejects.toThrow('roll back');
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(await ctx.prisma.notification.count({ where: { userId: c.id } })).toBe(0);
      expect(spy).not.toHaveBeenCalledWith(c.id, NOTIFICATIONS_CHANGED, expect.anything());

      await ctx.prisma.$transaction(async (tx) => {
        await notifications.notify(tx, [entry]);
      });
      await eventually(() =>
        expect(spy).toHaveBeenCalledWith(c.id, NOTIFICATIONS_CHANGED, {
          eventId: expect.any(String) as string,
        }),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses links that are not paths on this site', async () => {
    const c = await customer(ctx);
    await expect(
      ctx.app.get(NotificationsService).notify(ctx.prisma, [
        {
          userId: c.id,
          type: 'ANNOUNCEMENT',
          title: 'x',
          body: 'y',
          link: 'https://evil.example',
        },
      ]),
    ).rejects.toThrow(/relative paths/);
  });

  it('deletes notifications older than the retention policy', async () => {
    const { customer: c } = await paidBooking();
    const [n] = (await inbox(c)).items as [NotificationView];
    await ctx.prisma.notification.update({
      where: { id: n.id },
      data: { createdAt: new Date(Date.now() - 200 * 24 * 3600 * 1000) },
    });
    const result = await ctx.app.get(NotificationsMaintenanceService).runOnce();
    expect(result.deleted).toBe(1);
    expect((await inbox(c)).total).toBe(0);
  });
});

describe('announcements', () => {
  const SEND = '/api/v1/admin/notifications/broadcasts';

  it('need notifications.send', async () => {
    const body = { audience: 'ALL', title: 'Hello there', body: 'News' };
    const c = await customer(ctx);
    await ctx.http().post(SEND).set(c.auth).send(body).expect(403);
    const finance = await adminAuth(ctx, ['finance_admin']);
    await ctx.http().post(SEND).set(finance.auth).send(body).expect(403);
    const marketing = await adminAuth(ctx, ['marketing_manager']);
    await ctx.http().post(SEND).set(marketing.auth).send(body).expect(201);
  });

  it('reach exactly the chosen audience, are audited and listed', async () => {
    const admin = await adminAuth(ctx, ['super_admin']);
    const c = await customer(ctx);
    const agent = await createAgent(ctx);
    const suspended = await customer(ctx);
    await ctx.prisma.user.update({ where: { id: suspended.id }, data: { status: 'SUSPENDED' } });

    const gateway = ctx.app.get(RealtimeGateway);
    const toAll = vi.spyOn(gateway, 'emitToAll');
    const res = await ctx
      .http()
      .post(SEND)
      .set(admin.auth)
      .send({
        audience: 'AGENTS',
        title: 'New: featured listings',
        body: 'Feature your best property on the homepage.',
        link: '/agent/subscription/plans',
      })
      .expect(201);
    expect(toAll).toHaveBeenCalledWith(NOTIFICATIONS_CHANGED, expect.anything());
    toAll.mockRestore();
    expect(res.body.data).toMatchObject({ audience: 'AGENTS', recipientCount: 1 });

    expect((await inbox(agent)).items[0]).toMatchObject({
      type: 'ANNOUNCEMENT',
      title: 'New: featured listings',
      link: '/agent/subscription/plans',
    });
    expect((await inbox(c)).total).toBe(0);
    expect((await inbox(admin)).total).toBe(0);

    const all = await ctx
      .http()
      .post(SEND)
      .set(admin.auth)
      .send({ audience: 'ALL', title: 'Happy holidays', body: 'From all of us.' })
      .expect(201);
    // Active customers and agents only (not admins, not suspended accounts).
    expect(all.body.data.recipientCount).toBe(2);
    expect(await ctx.prisma.notification.count({ where: { userId: suspended.id } })).toBe(0);

    const audit = await ctx.prisma.auditLog.findMany({
      where: { action: 'notification.broadcast.sent' },
    });
    expect(audit).toHaveLength(2);
    expect(audit[0]!.actorId).toBe(admin.id);

    const history = await ctx.http().get(SEND).set(admin.auth).expect(200);
    expect(history.body.data.items.map((b: { title: string }) => b.title)).toEqual([
      'Happy holidays',
      'New: featured listings',
    ]);
  });

  it('can go to one person by email', async () => {
    const admin = await adminAuth(ctx, ['super_admin']);
    const c = await customer(ctx);
    const other = await customer(ctx);
    const res = await ctx
      .http()
      .post(SEND)
      .set(admin.auth)
      .send({ audience: 'USER', email: c.email.toUpperCase(), title: 'Your code', body: 'Hi' })
      .expect(201);
    expect(res.body.data).toMatchObject({ recipientCount: 1, recipientEmail: c.email });
    expect((await inbox(c)).total).toBe(1);
    expect((await inbox(other)).total).toBe(0);

    await ctx
      .http()
      .post(SEND)
      .set(admin.auth)
      .send({ audience: 'USER', email: 'nobody@example.com', title: 'Your code', body: 'Hi' })
      .expect(404);
  });

  it('validate the audience, email and link', async () => {
    const admin = await adminAuth(ctx, ['super_admin']);
    for (const body of [
      { audience: 'USER', title: 'Hello', body: 'x' },
      { audience: 'EVERYONE', title: 'Hello', body: 'x' },
      { audience: 'ALL', title: 'Hello', body: 'x', link: 'https://evil.example' },
      { audience: 'ALL', title: 'Hello', body: 'x', link: '//evil.example' },
      { audience: 'ALL', title: 'Hi', body: '' },
    ]) {
      await ctx.http().post(SEND).set(admin.auth).send(body).expect(422);
    }
  });
});
