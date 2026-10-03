import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CmsMaintenanceService } from '../src/modules/cms/cms-maintenance.service';
import { adminAuth } from './helpers/booking-helpers';
import { createTestContext, type TestContext } from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

async function enable(settings: Record<string, unknown> = {}) {
  const content = (await adminAuth(ctx, ['content_manager'])).auth;
  await ctx
    .http()
    .patch('/api/v1/admin/cms/site')
    .set(content)
    .send({ newsletterEnabled: true, newsletterConsentText: 'Send me HavenHub news.', ...settings })
    .expect(200);
}

const subscribe = (email: string) =>
  ctx.http().post('/api/v1/newsletter/subscribe').send({ email, consent: true });

function linkFrom(email: string, path: string) {
  const text = ctx.mail.lastTo(email)?.text ?? '';
  const match = new RegExp(`${path}\\?token=([^\\s]+)`).exec(text);
  expect(match, `expected a ${path} link`).not.toBeNull();
  return decodeURIComponent(match![1]!);
}

async function confirmed(email: string) {
  await subscribe(email).expect(202);
  await ctx
    .http()
    .post('/api/v1/newsletter/confirm')
    .send({ token: linkFrom(email, '/newsletter/confirm') })
    .expect(200);
}

describe('subscribing', () => {
  it('needs the feature, explicit consent and email confirmation; records the consent', async () => {
    await subscribe('a@example.com').expect(404);
    await enable();
    await ctx
      .http()
      .post('/api/v1/newsletter/subscribe')
      .send({ email: 'a@example.com' })
      .expect(422);
    await ctx
      .http()
      .post('/api/v1/newsletter/subscribe')
      .send({ email: 'a@example.com', consent: false })
      .expect(422);
    const res = await subscribe('A@Example.com').expect(202);
    expect(res.body.data).toEqual({ received: true, confirmationRequired: true });
    let sub = await ctx.prisma.emailSubscriber.findUniqueOrThrow({
      where: { email: 'a@example.com' },
    });
    expect(sub).toMatchObject({
      status: 'PENDING',
      consentText: 'Send me HavenHub news.',
      consentSource: 'footer',
    });

    await ctx
      .http()
      .post('/api/v1/newsletter/confirm')
      .send({ token: 'x'.repeat(40) })
      .expect(400);
    await ctx
      .http()
      .post('/api/v1/newsletter/confirm')
      .send({ token: linkFrom('a@example.com', '/newsletter/confirm') })
      .expect(200);
    sub = await ctx.prisma.emailSubscriber.findUniqueOrThrow({ where: { email: 'a@example.com' } });
    expect(sub.status).toBe('SUBSCRIBED');
    // Already subscribed: same answer, no new email.
    ctx.mail.clear();
    const again = await subscribe('a@example.com').expect(202);
    expect(again.body).toEqual(res.body);
    expect(ctx.mail.sent).toHaveLength(0);
    const events = await ctx.prisma.emailSubscriberEvent.findMany({
      where: { subscriberId: sub.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.type)).toEqual(['REQUESTED', 'CONFIRMED']);
    expect(events[0]!.consentText).toBe('Send me HavenHub news.');
    expect(events[0]!.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('retention anonymises former and unconfirmed subscribers only, keeping the history', async () => {
    await enable();
    await confirmed('active@example.com');
    await confirmed('left-long-ago@example.com');
    await confirmed('left-recently@example.com');
    await subscribe('never-confirmed@example.com').expect(202);
    const marketing = (await adminAuth(ctx, ['marketing_manager'])).auth;
    const idOf = async (email: string) =>
      (await ctx.prisma.emailSubscriber.findUniqueOrThrow({ where: { email } })).id;
    for (const email of ['left-long-ago@example.com', 'left-recently@example.com']) {
      await ctx
        .http()
        .post(`/api/v1/admin/newsletter/subscribers/${await idOf(email)}/unsubscribe`)
        .set(marketing)
        .expect(200);
    }
    const day = 86_400_000;
    const old = new Date(Date.now() - 40 * day);
    const activeId = await idOf('active@example.com');
    await ctx.prisma.emailSubscriber.update({
      where: { id: activeId },
      data: { confirmedAt: old, consentAt: old },
    });
    await ctx.prisma.emailSubscriber.update({
      where: { email: 'left-long-ago@example.com' },
      data: { unsubscribedAt: old },
    });
    await ctx.prisma.emailSubscriber.update({
      where: { email: 'never-confirmed@example.com' },
      data: { confirmTokenExpiresAt: old },
    });
    const svc = ctx.app.get(CmsMaintenanceService);

    // Off by default: nothing is erased.
    expect((await svc.runOnce()).subscribersErased).toBe(0);
    await enable({ newsletterRetentionDays: 30 });
    const goneId = await idOf('left-long-ago@example.com');
    const pendingId = await idOf('never-confirmed@example.com');
    expect((await svc.runOnce()).subscribersErased).toBe(2);
    expect((await svc.runOnce()).subscribersErased).toBe(0);

    const gone = await ctx.prisma.emailSubscriber.findUniqueOrThrow({ where: { id: goneId } });
    expect(gone).toMatchObject({
      email: `erased-${goneId}@erased.invalid`,
      status: 'UNSUBSCRIBED',
      consentText: 'Send me HavenHub news.',
    });
    expect(gone.erasedAt).not.toBeNull();
    const pending = await ctx.prisma.emailSubscriber.findUniqueOrThrow({
      where: { id: pendingId },
    });
    expect(pending).toMatchObject({ status: 'PENDING', confirmTokenHash: null });
    expect(pending.email).toBe(`erased-${pendingId}@erased.invalid`);
    // Current and recent subscribers are untouched.
    for (const email of ['active@example.com', 'left-recently@example.com']) {
      expect(
        (await ctx.prisma.emailSubscriber.findUniqueOrThrow({ where: { email } })).erasedAt,
      ).toBeNull();
    }

    // The consent history stays, without the hashed IPs, ending in ERASED.
    const events = await ctx.prisma.emailSubscriberEvent.findMany({
      where: { subscriberId: goneId },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.type)).toEqual(['REQUESTED', 'CONFIRMED', 'UNSUBSCRIBED', 'ERASED']);
    expect(events.every((e) => e.ipHash === null)).toBe(true);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'newsletter.subscriber_retention_erased' },
      }),
    ).toBe(2);
    // An anonymised record can never be made a subscriber again…
    await expect(
      ctx.prisma.emailSubscriber.update({ where: { id: goneId }, data: { status: 'SUBSCRIBED' } }),
    ).rejects.toThrow();
    // …but the person can sign up afresh, with new consent.
    await subscribe('left-long-ago@example.com').expect(202);
    const fresh = await ctx.prisma.emailSubscriber.findUniqueOrThrow({
      where: { email: 'left-long-ago@example.com' },
    });
    expect(fresh.id).not.toBe(goneId);
    expect(fresh.status).toBe('PENDING');
  });

  it('confirmation links expire', async () => {
    await enable();
    await subscribe('late@example.com').expect(202);
    const token = linkFrom('late@example.com', '/newsletter/confirm');
    await ctx.prisma.emailSubscriber.update({
      where: { email: 'late@example.com' },
      data: { confirmTokenExpiresAt: new Date(Date.now() - 1000) },
    });
    await ctx.http().post('/api/v1/newsletter/confirm').send({ token }).expect(400);
  });
});

describe('campaigns', () => {
  async function campaign(auth: Record<string, string>) {
    const c = (
      await ctx
        .http()
        .post('/api/v1/admin/newsletter/campaigns')
        .set(auth)
        .send({
          name: 'October news',
          subject: 'New homes this month',
          body: 'Hello!\n\n[See listings](/properties) <img src=x onerror=alert(1)> [x](javascript:alert(1))',
        })
        .expect(201)
    ).body.data;
    return c as { id: string };
  }

  it('reaches confirmed subscribers only, once each, with a working unsubscribe link', async () => {
    await enable();
    await confirmed('one@example.com');
    await confirmed('two@example.com');
    await subscribe('pending@example.com').expect(202);
    await confirmed('three@example.com');

    const marketing = (await adminAuth(ctx, ['marketing_manager'])).auth;
    const c = await campaign(marketing);
    expect(
      (
        await ctx
          .http()
          .get(`/api/v1/admin/newsletter/campaigns/${c.id}`)
          .set(marketing)
          .expect(200)
      ).body.data.eligibleRecipients,
    ).toBe(3);

    const svc = ctx.app.get(CmsMaintenanceService);
    await ctx
      .http()
      .post(`/api/v1/admin/newsletter/campaigns/${c.id}/schedule`)
      .set(marketing)
      .send({})
      .expect(200);
    ctx.mail.clear();
    // Two sweeps racing must not send anything twice.
    await Promise.all([svc.runOnce(), svc.runOnce()]);
    await svc.runOnce();
    const recipients = ctx.mail.sent.map((m) => m.to).sort();
    expect(recipients).toEqual(['one@example.com', 'three@example.com', 'two@example.com']);
    const mail = ctx.mail.lastTo('one@example.com')!;
    expect(mail.html).toContain('<a href="http://localhost:3000/properties">See listings</a>');
    expect(mail.html).not.toMatch(/<img src=x|onerror|javascript:/);
    expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const view = (
      await ctx.http().get(`/api/v1/admin/newsletter/campaigns/${c.id}`).set(marketing).expect(200)
    ).body.data;
    expect(view).toMatchObject({ status: 'SENT', stats: { total: 3, sent: 3, pending: 0 } });

    // One-click unsubscribe (mail client POST with the token in the query).
    const token = /unsubscribe\?token=([^\s>]+)/.exec(mail.headers!['List-Unsubscribe']!)![1]!;
    await ctx.http().post(`/api/v1/newsletter/unsubscribe?token=${token}`).expect(200);
    await ctx.http().post(`/api/v1/newsletter/unsubscribe?token=${token}`).expect(200);
    await ctx
      .http()
      .post('/api/v1/newsletter/unsubscribe')
      .send({ token: `${token.split('.')[0]}.forged` })
      .expect(400);
    const one = await ctx.prisma.emailSubscriber.findUniqueOrThrow({
      where: { email: 'one@example.com' },
    });
    expect(one.status).toBe('UNSUBSCRIBED');

    // A second campaign skips the unsubscribed address.
    const c2 = await campaign(marketing);
    await ctx
      .http()
      .post(`/api/v1/admin/newsletter/campaigns/${c2.id}/schedule`)
      .set(marketing)
      .send({})
      .expect(200);
    ctx.mail.clear();
    await svc.runOnce();
    expect(ctx.mail.sent.map((m) => m.to).sort()).toEqual(['three@example.com', 'two@example.com']);
  });

  it('consent is re-checked at send time; cancelling stops the rest', async () => {
    await enable();
    await confirmed('x@example.com');
    await confirmed('y@example.com');
    const marketing = (await adminAuth(ctx, ['marketing_manager'])).auth;
    const c = await campaign(marketing);
    await ctx
      .http()
      .post(`/api/v1/admin/newsletter/campaigns/${c.id}/schedule`)
      .set(marketing)
      .send({})
      .expect(200);
    // Snapshot taken, then x@ unsubscribes before the batch is sent.
    await ctx.prisma.emailCampaign.update({
      where: { id: c.id },
      data: { status: 'SENDING', startedAt: new Date() },
    });
    await ctx.prisma
      .$executeRaw`INSERT INTO email_campaign_deliveries (id, campaign_id, subscriber_id, status, created_at)
      SELECT gen_random_uuid(), ${c.id}::uuid, id, 'PENDING', now() FROM email_subscribers`;
    await ctx.prisma.emailSubscriber.update({
      where: { email: 'x@example.com' },
      data: { status: 'UNSUBSCRIBED' },
    });
    ctx.mail.clear();
    await ctx.app.get(CmsMaintenanceService).runOnce();
    expect(ctx.mail.sent.map((m) => m.to)).toEqual(['y@example.com']);

    const later = await campaign(marketing);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await ctx
      .http()
      .post(`/api/v1/admin/newsletter/campaigns/${later.id}/schedule`)
      .set(marketing)
      .send({ scheduledAt: future })
      .expect(200);
    ctx.mail.clear();
    await ctx.app.get(CmsMaintenanceService).runOnce();
    expect(ctx.mail.sent).toHaveLength(0);
    await ctx
      .http()
      .post(`/api/v1/admin/newsletter/campaigns/${later.id}/cancel`)
      .set(marketing)
      .expect(200);
    expect(
      (
        await ctx
          .http()
          .get(`/api/v1/admin/newsletter/campaigns/${later.id}`)
          .set(marketing)
          .expect(200)
      ).body.data.status,
    ).toBe('DRAFT');
  });

  it('failed deliveries are recorded and never resent (no retry in this phase)', async () => {
    await enable();
    await confirmed('ok@example.com');
    await confirmed('bounce@example.com');
    await confirmed('stuck@example.com');
    const marketing = (await adminAuth(ctx, ['marketing_manager'])).auth;
    const c = await campaign(marketing);
    await ctx
      .http()
      .post(`/api/v1/admin/newsletter/campaigns/${c.id}/schedule`)
      .set(marketing)
      .send({})
      .expect(200);
    const svc = ctx.app.get(CmsMaintenanceService);

    // A delivery claimed by a sender that then crashed (simulated): left SENDING.
    await ctx.prisma.emailCampaign.update({
      where: { id: c.id },
      data: { status: 'SENDING', startedAt: new Date() },
    });
    await ctx.prisma
      .$executeRaw`INSERT INTO email_campaign_deliveries (id, campaign_id, subscriber_id, status, created_at)
      SELECT gen_random_uuid(), ${c.id}::uuid, id, 'PENDING', now() FROM email_subscribers`;
    const stuck = await ctx.prisma.emailSubscriber.findUniqueOrThrow({
      where: { email: 'stuck@example.com' },
    });
    await ctx.prisma.emailCampaignDelivery.updateMany({
      where: { campaignId: c.id, subscriberId: stuck.id },
      data: { status: 'SENDING', claimedAt: new Date(Date.now() - 20 * 60_000) },
    });

    ctx.mail.clear();
    const send = ctx.mail.send.bind(ctx.mail);
    const spy = vi
      .spyOn(ctx.mail, 'send')
      .mockImplementation((message) =>
        message.to === 'bounce@example.com'
          ? Promise.reject(new Error('550 mailbox unavailable'))
          : send(message),
      );
    try {
      await svc.runOnce();
      await svc.runOnce();
      await svc.runOnce();
    } finally {
      spy.mockRestore();
    }
    // Only the healthy address got the email, exactly once.
    expect(ctx.mail.sent.map((m) => m.to)).toEqual(['ok@example.com']);
    const rows = await ctx.prisma.emailCampaignDelivery.findMany({
      where: { campaignId: c.id },
      include: { subscriber: { select: { email: true } } },
    });
    const byEmail = Object.fromEntries(rows.map((r) => [r.subscriber.email, r]));
    expect(byEmail['ok@example.com']).toMatchObject({ status: 'SENT' });
    expect(byEmail['bounce@example.com']).toMatchObject({
      status: 'FAILED',
      error: '550 mailbox unavailable',
    });
    expect(byEmail['stuck@example.com']!.status).toBe('FAILED');
    expect(byEmail['stuck@example.com']!.error).toMatch(/not retried/);
    const view = (
      await ctx.http().get(`/api/v1/admin/newsletter/campaigns/${c.id}`).set(marketing).expect(200)
    ).body.data;
    expect(view).toMatchObject({
      status: 'SENT',
      stats: { total: 3, sent: 1, failed: 2, pending: 0 },
    });
  });

  it('sending needs marketing.send; content roles cannot see subscribers', async () => {
    const content = (await adminAuth(ctx, ['content_manager'])).auth;
    await ctx.http().get('/api/v1/admin/newsletter/subscribers').set(content).expect(403);
    await ctx.http().get('/api/v1/admin/newsletter/campaigns').set(content).expect(403);
    const admin = (await adminAuth(ctx, ['admin'])).auth;
    const c = await campaign(admin);
    const seo = (await adminAuth(ctx, ['seo_manager'])).auth;
    await ctx
      .http()
      .post(`/api/v1/admin/newsletter/campaigns/${c.id}/schedule`)
      .set(seo)
      .send({})
      .expect(403);
  });
});
