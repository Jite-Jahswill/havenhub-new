import type {
  AssistantHandoffResult,
  AssistantQuestionView,
  AssistantReply,
  Paginated,
} from '@havenhub/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminAuth, customer } from './helpers/booking-helpers';
import {
  createAgent,
  createPublished,
  createTestContext,
  type TestContext,
} from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

async function ask(text: string, auth?: Record<string, string>) {
  const req = ctx.http().post('/api/v1/assistant/ask');
  const res = await (auth ? req.set(auth) : req).send({ text }).expect(200);
  return res.body.data as AssistantReply;
}

async function setAssistant(assistant: Record<string, unknown>) {
  const admin = (await adminAuth(ctx, ['super_admin'])).auth;
  await ctx
    .http()
    .patch('/api/v1/admin/settings/policies')
    .set(admin)
    .send({ assistant })
    .expect(200);
}

describe('assistant', () => {
  it('answers property searches from published listings, for anyone', async () => {
    const listing = await createPublished(ctx, await createAgent(ctx)); // ₦4.5m/year, 3 bed, Lekki
    const hit = await ask('3 bedroom apartment in Lekki under 5m a year');
    expect(hit.intent).toBe('PROPERTY_SEARCH');
    expect(hit.cards).toHaveLength(1);
    expect(hit.cards[0]).toMatchObject({
      title: 'Bright 3-bedroom apartment in Lekki',
      href: `/properties/${listing.slug}`,
    });

    const miss = await ask('apartments in Lekki under 100k');
    expect(miss.cards).toHaveLength(0);
    expect(miss.text).toMatch(/couldn’t find/);
  });

  it('needs sign-in for personal answers and only ever shows the visitor’s own data', async () => {
    const guest = await ask('where is my refund');
    expect(guest).toMatchObject({ intent: 'REFUND_STATUS', needsSignIn: true, cards: [] });

    const c = await customer(ctx);
    const mine = await ask('whats my refund status', c.auth);
    expect(mine).toMatchObject({ intent: 'REFUND_STATUS', needsSignIn: false });
    expect(mine.text).toMatch(/don’t have any refunds/);

    // Someone else's booking reference is not found on this account.
    const other = await ask('status of HH-ABCDEFGH', c.auth);
    expect(other.text).toMatch(/couldn’t find booking HH-ABCDEFGH/);
  });

  it('passes the visitor to support with the question, and tells support staff', async () => {
    const support = await adminAuth(ctx, ['support_admin']);
    const c = await customer(ctx);
    expect((await ask('I want to talk to a human', c.auth)).offerHandoff).toBe(true);

    const res = await ctx
      .http()
      .post('/api/v1/assistant/handoff')
      .set(c.auth)
      .send({
        question: 'My key does not work',
        transcript: [{ from: 'user', text: 'My key does not work' }],
      })
      .expect(200);
    const { conversationId } = res.body.data as AssistantHandoffResult;

    const conversation = await ctx.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { messages: true },
    });
    expect(conversation.contextType).toBe('SUPPORT');
    expect(conversation.messages[0]).toMatchObject({ type: 'SYSTEM' });
    expect(conversation.messages[0]!.body).toContain('“My key does not work”');
    expect(
      await ctx.prisma.notification.count({
        where: { userId: support.id, type: 'SUPPORT_REQUEST' },
      }),
    ).toBe(1);

    // It sits in the support queue, waiting for staff.
    const queue = await ctx
      .http()
      .get('/api/v1/admin/support/conversations?scope=unassigned')
      .set(support.auth)
      .expect(200);
    expect(queue.body.data.items.map((i: { id: string }) => i.id)).toContain(conversationId);

    // Guests sign in first.
    await ctx.http().post('/api/v1/assistant/handoff').send({}).expect(401);
  });

  it('shows support staff the questions it could not answer', async () => {
    await ask('blorp zzqx');
    await ask('hello');
    const support = await adminAuth(ctx, ['support_admin']);
    const page = (
      await ctx.http().get('/api/v1/admin/assistant/questions').set(support.auth).expect(200)
    ).body.data as Paginated<AssistantQuestionView>;
    expect(page.items.map((q) => q.text)).toEqual(['blorp zzqx']);
    const stats = await ctx
      .http()
      .get('/api/v1/admin/assistant/stats')
      .set(support.auth)
      .expect(200);
    expect(stats.body.data).toMatchObject({ questions: 2, answered: 1 });

    const finance = await adminAuth(ctx, ['finance_admin']);
    await ctx.http().get('/api/v1/admin/assistant/questions').set(finance.auth).expect(403);
  });

  it('can be switched off by admins, and handoff separately', async () => {
    await setAssistant({ handoffEnabled: false });
    const c = await customer(ctx);
    expect((await ask('talk to a human', c.auth)).offerHandoff).toBe(false);
    await ctx.http().post('/api/v1/assistant/handoff').set(c.auth).send({}).expect(403);

    await setAssistant({ enabled: false });
    const off = await ctx.http().post('/api/v1/assistant/ask').send({ text: 'hello' }).expect(403);
    expect(off.body.code).toBe('FEATURE_DISABLED');
    const status = await ctx.http().get('/api/v1/platform/status').expect(200);
    expect(status.body.data.policies.assistant).toBeNull();
  });
});
