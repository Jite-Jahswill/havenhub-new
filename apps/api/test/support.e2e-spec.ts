import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminAuth, customer } from './helpers/booking-helpers';
import { createAgent, createTestContext, type TestContext } from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const start = (auth: Record<string, string>) =>
  ctx.http().post('/api/v1/conversations').set(auth).send({ contextType: 'SUPPORT' });

describe('support conversations (Phase 5 chat, SUPPORT context)', () => {
  it('customers and agents get one support thread each; admins cannot start one', async () => {
    const c = await customer(ctx);
    const first = (await start(c.auth).expect(200)).body.data;
    const again = (await start(c.auth).expect(200)).body.data;
    expect(again.id).toBe(first.id);
    expect(first).toMatchObject({
      context: { type: 'SUPPORT' },
      participants: [expect.objectContaining({ role: 'CUSTOMER' })],
    });
    const agent = await createAgent(ctx);
    const agentThread = (await start(agent.auth).expect(200)).body.data;
    expect(agentThread.id).not.toBe(first.id);
    await start((await adminAuth(ctx, ['support_admin'])).auth).expect(403);
  });

  it('support staff join from the queue, then read and reply through normal chat routes', async () => {
    const c = await customer(ctx);
    const thread = (await start(c.auth).expect(200)).body.data;
    await ctx
      .http()
      .post(`/api/v1/conversations/${thread.id}/messages`)
      .set(c.auth)
      .send({ clientKey: `k-${Date.now()}-a`, body: 'I need help with a refund' })
      .expect(201);

    // The queue needs support.respond.
    await ctx
      .http()
      .get('/api/v1/admin/support/conversations')
      .set((await adminAuth(ctx, ['content_manager'])).auth)
      .expect(403);
    await ctx
      .http()
      .get('/api/v1/admin/support/conversations')
      .set((await adminAuth(ctx, ['admin'])).auth)
      .expect(403);
    const staff = await adminAuth(ctx, ['support_admin']);
    const queue = (
      await ctx
        .http()
        .get('/api/v1/admin/support/conversations?scope=unassigned')
        .set(staff.auth)
        .expect(200)
    ).body.data;
    expect(queue.items).toEqual([
      expect.objectContaining({
        id: thread.id,
        joined: false,
        requester: expect.objectContaining({ role: 'CUSTOMER' }),
      }),
    ]);

    // Not joined yet: the thread does not exist for them.
    await ctx.http().get(`/api/v1/conversations/${thread.id}/messages`).set(staff.auth).expect(404);
    await ctx
      .http()
      .post(`/api/v1/admin/support/conversations/${thread.id}/join`)
      .set(staff.auth)
      .expect(200);
    await ctx
      .http()
      .post(`/api/v1/admin/support/conversations/${thread.id}/join`)
      .set(staff.auth)
      .expect(200);
    const history = (
      await ctx
        .http()
        .get(`/api/v1/conversations/${thread.id}/messages`)
        .set(staff.auth)
        .expect(200)
    ).body.data;
    expect(history.items.map((m: { type: string }) => m.type)).toEqual(
      expect.arrayContaining(['TEXT', 'SYSTEM']),
    );
    await ctx
      .http()
      .post(`/api/v1/conversations/${thread.id}/messages`)
      .set(staff.auth)
      .send({ clientKey: `k-${Date.now()}-b`, body: 'Happy to help.' })
      .expect(201);
    const seen = (
      await ctx.http().get(`/api/v1/conversations/${thread.id}/messages`).set(c.auth).expect(200)
    ).body.data;
    expect(seen.items.some((m: { body: string | null }) => m.body === 'Happy to help.')).toBe(true);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'support.joined', resourceId: thread.id },
      }),
    ).toBe(1);

    // Another support admin who has not joined still sees nothing.
    const other = await adminAuth(ctx, ['support_admin']);
    await ctx.http().get(`/api/v1/conversations/${thread.id}`).set(other.auth).expect(404);
  });

  it('only support conversations can be joined; the database enforces the context shape', async () => {
    const staff = await adminAuth(ctx, ['support_admin']);
    const c = await customer(ctx);
    const thread = (await start(c.auth).expect(200)).body.data;
    const fake = '00000000-0000-7000-8000-000000000000';
    await ctx
      .http()
      .post(`/api/v1/admin/support/conversations/${fake}/join`)
      .set(staff.auth)
      .expect(404);
    await expect(
      ctx.prisma.$executeRawUnsafe(
        `UPDATE conversations SET context_type = 'PROPERTY' WHERE id = '${thread.id}'`,
      ),
    ).rejects.toThrow(/conversations_context_check/);
  });
});
