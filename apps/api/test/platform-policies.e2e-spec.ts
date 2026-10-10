import { randomBytes } from 'node:crypto';

import {
  DEFAULT_ASSISTANT_GREETING,
  DEFAULT_CHAT_CONTACT_WARNING,
  POLICY_DEFAULTS,
  type ConversationSummary,
  type MessageView,
  type PlatformPoliciesView,
  type PlatformStatusView,
} from '@havenhub/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ChatNotificationsService } from '../src/modules/chat/chat-notifications.service';
import { PlatformPoliciesService } from '../src/modules/platform/platform-policies.service';
import { SubscriptionMaintenanceService } from '../src/modules/subscriptions/subscription-maintenance.service';
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
import {
  bearer,
  createAgent,
  createDraft,
  createPublished,
  createTestContext,
  loginToken,
  testImage,
  tokenFromMail,
  uniqueEmail,
  type Agent,
  type TestContext,
} from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const POLICIES = '/api/v1/admin/settings/policies';
const superAdmin = async () => (await adminAuth(ctx, ['super_admin'])).auth;

async function setPolicies(patch: Record<string, unknown>, auth?: Record<string, string>) {
  const res = await ctx
    .http()
    .patch(POLICIES)
    .set(auth ?? (await superAdmin()))
    .send(patch);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as PlatformPoliciesView;
}

function startConversation(who: { auth: Record<string, string> }, propertyId: string) {
  return ctx
    .http()
    .post('/api/v1/conversations')
    .set(who.auth)
    .send({ contextType: 'PROPERTY', propertyId });
}

async function sendMessage(who: { auth: Record<string, string> }, conversationId: string) {
  const res = await ctx
    .http()
    .post(`/api/v1/conversations/${conversationId}/messages`)
    .set(who.auth)
    .send({ clientKey: randomBytes(8).toString('hex'), body: 'Is it still available?' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as MessageView;
}

/** A customer in a conversation about a published property. */
async function chat() {
  const agent = await createAgent(ctx);
  const property = await createPublished(ctx, agent);
  const c = await customer(ctx);
  const res = await startConversation(c, property.id);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { agent, property, customer: c, conversation: res.body.data as ConversationSummary };
}

async function publishedCleaning(agent: Agent) {
  const admin = await superAdmin();
  await ctx
    .http()
    .patch('/api/v1/admin/settings/moderation')
    .set(admin)
    .send({ CLEANING: false })
    .expect(200);
  const res = await ctx.http().post('/api/v1/agents/me/experiences').set(agent.auth).send(CLEANING);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const { id } = res.body.data as { id: string };
  await ctx
    .http()
    .post(`/api/v1/agents/me/experiences/${id}/images`)
    .set(agent.auth)
    .attach('file', await testImage(), { filename: 'photo.jpg', contentType: 'image/jpeg' })
    .expect(201);
  const submitted = await ctx
    .http()
    .post(`/api/v1/agents/me/experiences/${id}/submit`)
    .set(agent.auth)
    .expect(200);
  return submitted.body.data as { id: string; slug: string; status: string };
}

const CLEANING = {
  kind: 'CLEANING',
  title: 'Sparkle home cleaning',
  description: 'Thorough home and apartment cleaning by a vetted, insured team of cleaners.',
  city: 'Ikeja',
  state: 'Lagos',
  cleaning: { priceKobo: 2_000_000, serviceAreas: ['Ikeja'], availableDays: ['MON'] },
};

describe('admin platform policies', () => {
  it('start from the built-in defaults and are public where the site needs them', async () => {
    const res = await ctx
      .http()
      .get(POLICIES)
      .set(await superAdmin())
      .expect(200);
    expect(res.body.data).toEqual({ policies: POLICY_DEFAULTS, updatedAt: null });

    const status = (await ctx.http().get('/api/v1/platform/status').expect(200)).body
      .data as PlatformStatusView;
    expect(status.policies).toEqual({
      passwordMinLength: 10,
      bookingsEnabled: true,
      experiences: { EVENT: true, TOUR: true, HOTEL: true, CLEANING: true },
      chat: {
        newConversations: true,
        attachments: true,
        contactWarning: DEFAULT_CHAT_CONTACT_WARNING,
      },
      assistant: { greeting: DEFAULT_ASSISTANT_GREETING, handoffEnabled: true },
    });
  });

  it('need settings.manage, and refuse unknown areas, unknown keys and out-of-range values', async () => {
    const finance = await adminAuth(ctx, ['finance_admin']);
    await ctx.http().get(POLICIES).set(finance.auth).expect(403);
    await ctx
      .http()
      .patch(POLICIES)
      .set(finance.auth)
      .send({ booking: { enabled: false } })
      .expect(403);
    const c = await customer(ctx);
    await ctx.http().get(POLICIES).set(c.auth).expect(403);

    const admin = await superAdmin();
    for (const body of [
      {},
      { withdrawals: { enabled: true } },
      { booking: { surprise: 1 } },
      { booking: { maxOpenHoldsPerCustomer: 0 } },
      { storage: { imageMaxMb: 11 } },
      { security: { passwordMinLength: 9 } },
    ]) {
      await ctx.http().patch(POLICIES).set(admin).send(body).expect(422);
    }
  });

  it('merge partial changes, audit only the areas that changed, and skip no-op saves', async () => {
    const admin = await adminAuth(ctx, ['super_admin']);
    const after = await setPolicies(
      { booking: { maxOpenHoldsPerCustomer: 5 }, chat: { editWindowMinutes: 15 } },
      admin.auth,
    );
    expect(after.policies.booking).toEqual({
      ...POLICY_DEFAULTS.booking,
      maxOpenHoldsPerCustomer: 5,
    });
    expect(after.updatedAt).not.toBeNull();

    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'platform.policies.updated' },
    });
    expect(audit).toMatchObject({ actorId: admin.id, resourceType: 'platform_settings' });
    // chat.editWindowMinutes was already 15: only booking changed.
    expect(audit.before).toEqual({ booking: POLICY_DEFAULTS.booking });
    expect(audit.after).toEqual({ booking: after.policies.booking });

    await setPolicies({ booking: { maxOpenHoldsPerCustomer: 5 } }, admin.auth);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'platform.policies.updated' } }),
    ).toBe(1);

    // A later partial change keeps earlier values in other keys.
    const again = await setPolicies({ booking: { enabled: false } }, admin.auth);
    expect(again.policies.booking).toMatchObject({ enabled: false, maxOpenHoldsPerCustomer: 5 });
  });

  it('apply on every instance at once (the cache is rewritten on change)', async () => {
    const other = await createTestContext();
    try {
      expect((await other.app.get(PlatformPoliciesService).get()).booking.enabled).toBe(true);
      await setPolicies({ booking: { enabled: false } });
      expect((await other.app.get(PlatformPoliciesService).get()).booking.enabled).toBe(false);
    } finally {
      await other.close();
    }
  });
});

describe('security policy', () => {
  it('requires the configured password length for registration, reset and change', async () => {
    await setPolicies({ security: { passwordMinLength: 16 } });
    const res = await ctx
      .http()
      .post('/api/v1/auth/register/customer')
      .send({ fullName: 'Ada Obi', email: uniqueEmail('short'), password: 'fifteen-chars-x' })
      .expect(422);
    expect(res.body.message).toMatch(/at least 16 characters/);
    await ctx
      .http()
      .post('/api/v1/auth/register/customer')
      .send({ fullName: 'Ada Obi', email: uniqueEmail('long'), password: 'sixteen-chars-ok' })
      .expect(202);

    const c = await customer(ctx);
    await ctx.http().post('/api/v1/auth/forgot-password').send({ email: c.email }).expect(202);
    const token = tokenFromMail(ctx, c.email, '/reset-password');
    await ctx
      .http()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'fifteen-chars-x' })
      .expect(422);
    // The token was not used up by the refused attempt.
    await ctx
      .http()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'a-very-long-password-1' })
      .expect(200);

    const { tokens } = await loginToken(ctx, {
      email: c.email,
      password: 'a-very-long-password-1',
    });
    await ctx
      .http()
      .post('/api/v1/auth/change-password')
      .set(bearer(tokens.accessToken))
      .send({ currentPassword: 'a-very-long-password-1', newPassword: 'still-too-short' })
      .expect(422);
  });

  it('expires new sign-ins after the configured inactivity period', async () => {
    await setPolicies({ security: { sessionDays: 2 } });
    const c = await customer(ctx);
    const session = await ctx.prisma.session.findFirstOrThrow({ where: { userId: c.id } });
    const days = (session.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(1.9);
    expect(days).toBeLessThanOrEqual(2);
  });
});

describe('storage policy', () => {
  it('limits image uploads to the configured size', async () => {
    const agent = await createAgent(ctx);
    const draft = await createDraft(ctx, agent);
    const sharp = (await import('sharp')).default;
    // Random noise barely compresses: well over 1 MB.
    const noisy = await sharp(randomBytes(1400 * 1000 * 3), {
      raw: { width: 1400, height: 1000, channels: 3 },
    })
      .jpeg({ quality: 100 })
      .toBuffer();
    expect(noisy.length).toBeGreaterThan(1024 * 1024);

    await setPolicies({ storage: { imageMaxMb: 1 } });
    const res = await ctx
      .http()
      .post(`/api/v1/agents/me/properties/${draft.id}/images`)
      .set(agent.auth)
      .attach('file', noisy, { filename: 'big.jpg', contentType: 'image/jpeg' })
      .expect(422);
    expect(res.body.message).toBe('Images must be 1 MB or smaller.');
    await ctx
      .http()
      .post(`/api/v1/agents/me/properties/${draft.id}/images`)
      .set(agent.auth)
      .attach('file', await testImage(), { filename: 'small.jpg', contentType: 'image/jpeg' })
      .expect(201);
  });

  it('limits chat attachments, and attachments can be turned off', async () => {
    const { customer: c, conversation } = await chat();
    const upload = (file: Buffer) =>
      ctx
        .http()
        .post(`/api/v1/conversations/${conversation.id}/attachments`)
        .set(c.auth)
        .attach('file', file, { filename: 'notes.pdf', contentType: 'application/pdf' });
    const twoMb = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2 * 1024 * 1024, 32)]);

    await setPolicies({ storage: { chatAttachmentMaxMb: 1 } });
    const tooBig = await upload(twoMb).expect(422);
    expect(tooBig.body.message).toMatch(/up to 1 MB/);
    await upload(Buffer.from('%PDF-1.7\n1 0 obj\n')).expect(201);

    await setPolicies({ chat: { attachments: false } });
    const off = await upload(Buffer.from('%PDF-1.7\n1 0 obj\n')).expect(403);
    expect(off.body.code).toBe('FEATURE_DISABLED');
  });
});

describe('booking policy', () => {
  it('can stop new bookings', async () => {
    await setPricing(ctx);
    const { property } = await rental(ctx);
    const c = await customer(ctx);
    await setPolicies({ booking: { enabled: false } });
    const res = await ctx
      .http()
      .post('/api/v1/bookings')
      .set(c.auth)
      .send({ propertyId: property.id, startDate: inDays(10), quantity: 1 })
      .expect(403);
    expect(res.body.code).toBe('FEATURE_DISABLED');
    expect((await ctx.http().get('/api/v1/platform/status')).body.data.policies).toMatchObject({
      bookingsEnabled: false,
    });
  });

  it('applies the hold time, the advance window and the open-holds limit', async () => {
    await setPricing(ctx);
    const { property } = await rental(ctx);
    const c = await customer(ctx);
    await setPolicies({
      booking: { holdMinutes: 10, maxAdvanceDays: 30, maxOpenHoldsPerCustomer: 1 },
    });

    await book(ctx, c, { propertyId: property.id, startDate: inDays(40), quantity: 1 }, 422);
    const first = await book(ctx, c, {
      propertyId: property.id,
      startDate: inDays(5),
      quantity: 1,
    });
    const row = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: first.id } });
    const minutes = (row.holdExpiresAt!.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(9);
    expect(minutes).toBeLessThanOrEqual(10);

    await book(ctx, c, { propertyId: property.id, startDate: inDays(15), quantity: 1 }, 409);
  });
});

describe('refunds policy', () => {
  async function paidBooking(startsInDays: number) {
    await setPricing(ctx);
    const { agent, property } = await rental(ctx);
    const c: Customer = await customer(ctx);
    const b = await book(ctx, c, {
      propertyId: property.id,
      startDate: inDays(startsInDays),
      quantity: 1,
    });
    await payWithTestProvider(ctx, c, b.id);
    return { agent, customer: c, booking: b };
  }

  it('stops customers cancelling inside the cut-off; agents still can', async () => {
    const { agent, customer: c, booking } = await paidBooking(3);
    await setPolicies({ refunds: { customerCancelCutoffDays: 5 } });

    const detail = await ctx.http().get(`/api/v1/bookings/${booking.id}`).set(c.auth).expect(200);
    expect(detail.body.data.canCancel).toBe(false);
    const refused = await ctx
      .http()
      .post(`/api/v1/bookings/${booking.id}/cancel`)
      .set(c.auth)
      .send({})
      .expect(409);
    expect(refused.body.message).toMatch(/up to 5 days before check-in/);

    await ctx
      .http()
      .post(`/api/v1/agents/me/bookings/${booking.id}/cancel`)
      .set(agent.auth)
      .send({})
      .expect(200);
  });

  it('still lets customers cancel (full refund) before the cut-off', async () => {
    const { customer: c, booking } = await paidBooking(10);
    await setPolicies({ refunds: { customerCancelCutoffDays: 5 } });
    await ctx.http().post(`/api/v1/bookings/${booking.id}/cancel`).set(c.auth).send({}).expect(200);
    expect(await ctx.prisma.refund.count({ where: { bookingId: booking.id } })).toBe(1);
  });
});

describe('chat policy', () => {
  it('can stop new listing conversations while support and existing ones continue', async () => {
    const { property, customer: c, conversation } = await chat();
    await setPolicies({ chat: { newConversations: false } });

    const other = await customer(ctx);
    const refused = await startConversation(other, property.id).expect(403);
    expect(refused.body.code).toBe('FEATURE_DISABLED');
    // Existing: returned as before, and messaging continues.
    await startConversation(c, property.id).expect(200);
    await sendMessage(c, conversation.id);
    await ctx
      .http()
      .post('/api/v1/conversations')
      .set(other.auth)
      .send({ contextType: 'SUPPORT' })
      .expect(200);
  });

  it('applies the edit window, including turning editing off', async () => {
    const { customer: c, conversation } = await chat();
    const message = await sendMessage(c, conversation.id);
    expect(message.canEdit).toBe(true);

    await setPolicies({ chat: { editWindowMinutes: 0 } });
    const res = await ctx
      .http()
      .patch(`/api/v1/messages/${message.id}`)
      .set(c.auth)
      .send({ body: 'Edited' })
      .expect(409);
    expect(res.body.message).toBe('Editing messages is turned off.');
    const page = await ctx
      .http()
      .get(`/api/v1/conversations/${conversation.id}/messages`)
      .set(c.auth)
      .expect(200);
    expect((page.body.data.items as MessageView[]).at(-1)!.canEdit).toBe(false);
  });

  it('publishes the contact details warning: custom wording, or off', async () => {
    const warning = async () =>
      (
        (await ctx.http().get('/api/v1/platform/status').expect(200)).body
          .data as PlatformStatusView
      ).policies.chat.contactWarning;
    await setPolicies({ chat: { contactWarningText: 'Pay only on HavenHub.' } });
    expect(await warning()).toBe('Pay only on HavenHub.');
    await setPolicies({ chat: { contactWarning: false } });
    expect(await warning()).toBeNull();
    await setPolicies({ chat: { contactWarning: true, contactWarningText: null } });
    expect(await warning()).toBe(DEFAULT_CHAT_CONTACT_WARNING);
  });
});

describe('events policy', () => {
  it('hides a turned-off kind from the public and stops new listings of it', async () => {
    const agent = await createAgent(ctx);
    const listing = await publishedCleaning(agent);
    expect(listing.status).toBe('PUBLISHED');
    const search = () => ctx.http().get('/api/v1/experiences?kind=CLEANING').expect(200);
    expect((await search()).body.data.total).toBe(1);

    await setPolicies({ events: { CLEANING: false } });
    expect((await search()).body.data.total).toBe(0);
    await ctx.http().get(`/api/v1/experiences/${listing.slug}`).expect(404);
    const created = await ctx
      .http()
      .post('/api/v1/agents/me/experiences')
      .set(agent.auth)
      .send(CLEANING)
      .expect(403);
    expect(created.body.code).toBe('FEATURE_DISABLED');
    // Kept, not deleted: back as soon as the kind is turned on again.
    await setPolicies({ events: { CLEANING: true } });
    expect((await search()).body.data.total).toBe(1);
  });
});

describe('notifications policy', () => {
  it('can turn off unread-chat emails, including ones already scheduled', async () => {
    const { agent, customer: c, conversation } = await chat();
    const notifications = ctx.app.get(ChatNotificationsService);
    await sendMessage(c, conversation.id); // scheduled while emails are on
    await setPolicies({ notifications: { chatEmails: false } });
    await sendMessage(c, conversation.id);
    expect(await notifications.sendDue(Date.now() + 24 * 3600_000)).toBe(0);
    expect(ctx.mail.lastTo(agent.email)?.subject ?? '').not.toMatch(/message/);
  });

  it('uses the configured unread-chat email delay', async () => {
    const { agent, customer: c, conversation } = await chat();
    await setPolicies({ notifications: { chatEmailDelayMinutes: 60 } });
    const notifications = ctx.app.get(ChatNotificationsService);
    await sendMessage(c, conversation.id);
    expect(await notifications.sendDue(Date.now() + 30 * 60_000)).toBe(0);
    expect(await notifications.sendDue(Date.now() + 61 * 60_000)).toBe(1);
    expect(ctx.mail.lastTo(agent.email)).toBeDefined();
  });

  it('sends no subscription reminders when the reminder is set to 0 days', async () => {
    await setPolicies({ notifications: { subscriptionExpiryReminderDays: 0 } });
    expect(await ctx.app.get(SubscriptionMaintenanceService).sendReminders()).toBe(0);
  });
});
