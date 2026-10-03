import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminAuth, customer } from './helpers/booking-helpers';
import { createAdmin, createTestContext, type TestContext } from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const LOGS = '/api/v1/admin/audit-logs';

async function seedEntries(actorA: string, actorB: string) {
  const rows = [
    {
      actorId: actorA,
      action: 'property.moderation.approve',
      resourceType: 'property',
      resourceId: 'p-1',
      createdAt: new Date('2026-09-10T09:00:00Z'),
    },
    {
      actorId: actorA,
      action: 'property.moderation.reject',
      resourceType: 'property',
      resourceId: 'p-2',
      createdAt: new Date('2026-09-12T23:30:00Z'),
    },
    {
      actorId: actorB,
      action: 'user.status.updated',
      resourceType: 'user',
      resourceId: 'u-1',
      createdAt: new Date('2026-09-13T08:00:00Z'),
    },
    {
      actorId: null,
      action: 'job_application.cv_retention_deleted',
      resourceType: 'job_application',
      resourceId: 'j-1',
      createdAt: new Date('2026-09-20T12:00:00Z'),
    },
  ];
  for (const row of rows) {
    await ctx.prisma.auditLog.create({
      data: {
        ...row,
        before: { status: 'PENDING_REVIEW' },
        after: { status: 'PUBLISHED' },
        ipAddress: '203.0.114.7',
        userAgent: 'Mozilla/5.0 (QA)',
      },
    });
  }
}

describe('audit log', () => {
  it('filters by actor, action (exact or prefix), resource and Nigerian dates', async () => {
    const viewer = await adminAuth(ctx, ['finance_admin']);
    const a = await createAdmin(ctx, []);
    const b = await createAdmin(ctx, []);
    await ctx.prisma.user.update({ where: { id: b.id }, data: { fullName: 'Bola Moderator' } });
    await seedEntries(a.id, b.id);
    const query = async (params: Record<string, string>) => {
      const res = await ctx.http().get(LOGS).set(viewer.auth).query(params).expect(200);
      return (res.body.data.items as { action: string; resourceId: string }[]).map(
        (i) => i.resourceId,
      );
    };

    expect(await query({ actor: a.id })).toEqual(['p-2', 'p-1']);
    expect(await query({ actor: 'bola' })).toEqual(['u-1']);
    expect(await query({ actor: a.email.toUpperCase() })).toEqual(['p-2', 'p-1']);
    expect(await query({ action: 'property.' })).toEqual(['p-2', 'p-1']);
    expect(await query({ action: 'property.moderation.approve' })).toEqual(['p-1']);
    expect(await query({ action: 'property' })).toEqual([]);
    expect(await query({ resourceType: 'user' })).toEqual(['u-1']);
    expect(await query({ resourceType: 'property', resourceId: 'p-2' })).toEqual(['p-2']);
    // 23:30 UTC on the 12th is 00:30 on the 13th in Lagos.
    expect(await query({ from: '2026-09-13', to: '2026-09-13' })).toEqual(['u-1', 'p-2']);
    expect(await query({ from: '2026-09-01', to: '2026-09-12' })).toEqual(['p-1']);

    const page = await ctx
      .http()
      .get(LOGS)
      .set(viewer.auth)
      .query({ pageSize: 2, page: 2, action: 'property.' })
      .expect(200);
    expect(page.body.data).toMatchObject({ total: 2, page: 2, items: [] });

    for (const bad of [
      { from: '2026-13-01' },
      { from: '2026-09-10', to: '2026-09-01' },
      { pageSize: 500 },
    ]) {
      await ctx.http().get(LOGS).set(viewer.auth).query(bad).expect(422);
    }
  });

  it('shows before/after, IP and device on the detail view only', async () => {
    const viewer = await adminAuth(ctx, ['super_admin']);
    const actor = await createAdmin(ctx, []);
    await seedEntries(actor.id, actor.id);
    const list = await ctx
      .http()
      .get(LOGS)
      .set(viewer.auth)
      .query({ resourceId: 'p-1' })
      .expect(200);
    const item = list.body.data.items[0];
    expect(item).not.toHaveProperty('ipAddress');
    expect(item).not.toHaveProperty('before');

    const detail = await ctx.http().get(`${LOGS}/${item.id}`).set(viewer.auth).expect(200);
    expect(detail.body.data).toMatchObject({
      action: 'property.moderation.approve',
      before: { status: 'PENDING_REVIEW' },
      after: { status: 'PUBLISHED' },
      ipAddress: '203.0.114.7',
      userAgent: 'Mozilla/5.0 (QA)',
      actor: { id: actor.id, email: actor.email },
    });
    await ctx
      .http()
      .get(`${LOGS}/00000000-0000-4000-8000-000000000000`)
      .set(viewer.auth)
      .expect(404);
    await ctx.http().get(`${LOGS}/not-a-uuid`).set(viewer.auth).expect(400);
  });

  it('requires audit.view for the list and the detail', async () => {
    const owner = await adminAuth(ctx, ['super_admin']);
    await seedEntries(owner.id, owner.id);
    const id = (await ctx.prisma.auditLog.findFirstOrThrow()).id;
    for (const role of [
      'content_manager',
      'support_admin',
      'property_manager',
      'marketing_manager',
    ]) {
      const auth = (await adminAuth(ctx, [role])).auth;
      await ctx.http().get(LOGS).set(auth).expect(403);
      await ctx.http().get(`${LOGS}/${id}`).set(auth).expect(403);
    }
    const buyer = await customer(ctx);
    await ctx.http().get(`${LOGS}/${id}`).set(buyer.auth).expect(403);
    await ctx.http().get(LOGS).expect(401);
  });

  it('is append-only in the database, except the actor link when a user is deleted', async () => {
    const actor = await createAdmin(ctx, []);
    await seedEntries(actor.id, actor.id);
    const entry = await ctx.prisma.auditLog.findFirstOrThrow({ where: { actorId: actor.id } });

    await expect(
      ctx.prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(
      /append-only/,
    );
    await expect(
      ctx.prisma
        .$executeRaw`UPDATE audit_logs SET actor_id = NULL, action = 'x' WHERE id = ${entry.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      ctx.prisma.$executeRaw`DELETE FROM audit_logs WHERE resource_type = 'property'`,
    ).rejects.toThrow(/append-only/);

    // Deleting the acting user keeps every entry and only clears the link.
    const before = await ctx.prisma.auditLog.count();
    await ctx.prisma.user.delete({ where: { id: actor.id } });
    expect(await ctx.prisma.auditLog.count()).toBe(before);
    const kept = await ctx.prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } });
    expect(kept).toMatchObject({ actorId: null, action: entry.action, ipAddress: '203.0.114.7' });
  });
});
