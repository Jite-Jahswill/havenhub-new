import { PERMISSION_KEYS } from '@havenhub/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../src/modules/audit/audit.service';
import { syncRbac } from '../src/modules/rbac/rbac-sync';
import { adminAuth } from './helpers/booking-helpers';
import { createAdmin, createTestContext, type TestContext } from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const ROLES = '/api/v1/admin/rbac/roles';
const HR = {
  name: 'HR Recruiter',
  description: 'Reviews job applicants',
  permissions: ['careers.manage', 'careers.applications'],
};

type Auth = Record<string, string>;

async function createRole(auth: Auth, body: Record<string, unknown> = HR) {
  const res = await ctx.http().post(ROLES).set(auth).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { key: string; permissions: string[]; userCount: number };
}

const assign = (auth: Auth, userId: string, roleKeys: string[]) =>
  ctx.http().put(`/api/v1/admin/users/${userId}/roles`).set(auth).send({ roleKeys });

async function rolesOf(userId: string) {
  const rows = await ctx.prisma.userRole.findMany({
    where: { userId },
    include: { role: { select: { key: true } } },
  });
  return rows.map((r) => r.role.key).sort();
}

describe('custom roles', () => {
  it('can be created, read, edited and deleted, each change audited', async () => {
    const owner = await adminAuth(ctx, ['super_admin']);
    const role = await createRole(owner.auth);
    expect(role).toMatchObject({ key: 'custom_hr_recruiter', userCount: 0 });
    expect(role.permissions.sort()).toEqual(['careers.applications', 'careers.manage']);

    // Same name again gets its own key.
    const twin = await createRole(owner.auth);
    expect(twin.key).toBe('custom_hr_recruiter_2');

    const list = await ctx.http().get(ROLES).set(owner.auth).expect(200);
    expect(list.body.data.map((r: { key: string }) => r.key)).toEqual(
      expect.arrayContaining(['super_admin', 'admin', 'custom_hr_recruiter']),
    );

    const edited = await ctx
      .http()
      .patch(`${ROLES}/custom_hr_recruiter`)
      .set(owner.auth)
      .send({ name: 'Recruiter', permissions: ['careers.applications'] })
      .expect(200);
    expect(edited.body.data).toMatchObject({
      key: 'custom_hr_recruiter',
      name: 'Recruiter',
      permissions: ['careers.applications'],
      isSystem: false,
    });

    await ctx.http().delete(`${ROLES}/custom_hr_recruiter`).set(owner.auth).expect(200);
    await ctx.http().get(`${ROLES}/custom_hr_recruiter`).set(owner.auth).expect(404);

    const audits = await ctx.prisma.auditLog.findMany({
      where: { resourceType: 'role', resourceId: 'custom_hr_recruiter' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((a) => a.action)).toEqual([
      'rbac.role.created',
      'rbac.role.updated',
      'rbac.role.deleted',
    ]);
    expect(audits.every((a) => a.actorId === owner.id)).toBe(true);
    expect(audits[1]!.before).toMatchObject({ name: 'HR Recruiter' });
    expect(audits[1]!.after).toMatchObject({
      name: 'Recruiter',
      permissions: ['careers.applications'],
    });
  });

  it('grants careers.applications through assignment, and only then', async () => {
    const owner = await adminAuth(ctx, ['super_admin']);
    const role = await createRole(owner.auth);
    const recruiter = await adminAuth(ctx, ['content_manager']);
    await ctx.http().get('/api/v1/admin/careers/applications').set(recruiter.auth).expect(403);

    await assign(owner.auth, recruiter.id, ['content_manager', role.key]).expect(200);
    await ctx.http().get('/api/v1/admin/careers/applications').set(recruiter.auth).expect(200);
    const detail = await ctx.http().get(`${ROLES}/${role.key}`).set(owner.auth).expect(200);
    expect(detail.body.data.users.map((u: { id: string }) => u.id)).toEqual([recruiter.id]);
    expect(detail.body.data.userCount).toBe(1);

    await assign(owner.auth, recruiter.id, ['content_manager']).expect(200);
    await ctx.http().get('/api/v1/admin/careers/applications').set(recruiter.auth).expect(403);
  });

  it('cannot include, grant or touch permissions the actor does not hold', async () => {
    const owner = await adminAuth(ctx, ['super_admin']);
    const hr = await createRole(owner.auth);
    const delegate = await createRole(owner.auth, {
      name: 'Role admin',
      permissions: ['roles.manage', 'users.view', 'careers.manage'],
    });
    const actor = await adminAuth(ctx, []);
    await assign(owner.auth, actor.id, [delegate.key]).expect(200);
    const target = await createAdmin(ctx, []);

    // Creating with a permission the actor lacks.
    await ctx.http().post(ROLES).set(actor.auth).send(HR).expect(403);
    // Granting a role whose permissions exceed the actor's.
    await assign(actor.auth, target.id, [hr.key]).expect(403);
    // Editing or deleting a role the actor could not have created.
    await ctx
      .http()
      .patch(`${ROLES}/${hr.key}`)
      .set(actor.auth)
      .send({ permissions: ['careers.manage'] })
      .expect(403);
    await ctx.http().delete(`${ROLES}/${hr.key}`).set(actor.auth).expect(403);
    // Raising another role above the actor's own access.
    const small = await createRole(actor.auth, { name: 'Viewer', permissions: ['users.view'] });
    await ctx
      .http()
      .patch(`${ROLES}/${small.key}`)
      .set(actor.auth)
      .send({ permissions: ['users.view', 'payments.refund'] })
      .expect(403);
    // Editing a role they hold (would change their own access).
    await ctx
      .http()
      .patch(`${ROLES}/${delegate.key}`)
      .set(owner.auth)
      .send({ name: 'Renamed' })
      .expect(200);
    await ctx
      .http()
      .patch(`${ROLES}/${delegate.key}`)
      .set(actor.auth)
      .send({ name: 'Mine now' })
      .expect(403);
    // Within their own permissions everything works.
    await assign(actor.auth, target.id, [small.key]).expect(200);
    expect(await rolesOf(target.id)).toEqual([small.key]);

    const roleRow = await ctx.prisma.role.findUniqueOrThrow({
      where: { key: hr.key },
      include: { permissions: { include: { permission: true } } },
    });
    expect(roleRow.permissions.map((p) => p.permission.key).sort()).toEqual([
      'careers.applications',
      'careers.manage',
    ]);
  });

  it('keeps system roles read-only and untouched by the RBAC sync', async () => {
    const owner = await adminAuth(ctx, ['super_admin']);
    for (const key of ['super_admin', 'admin', 'finance_admin']) {
      await ctx
        .http()
        .patch(`${ROLES}/${key}`)
        .set(owner.auth)
        .send({ name: 'Renamed' })
        .expect(403);
      await ctx.http().delete(`${ROLES}/${key}`).set(owner.auth).expect(403);
    }
    const custom = await createRole(owner.auth);
    await syncRbac(ctx.prisma);
    const after = await ctx.http().get(`${ROLES}/${custom.key}`).set(owner.auth).expect(200);
    expect(after.body.data.permissions.sort()).toEqual(['careers.applications', 'careers.manage']);
    expect(after.body.data.isSystem).toBe(false);
  });

  it('cannot be deleted while assigned; holders are never removed silently', async () => {
    const owner = await adminAuth(ctx, ['super_admin']);
    const role = await createRole(owner.auth);
    const holder = await createAdmin(ctx, []);
    await assign(owner.auth, holder.id, [role.key]).expect(200);
    const res = await ctx.http().delete(`${ROLES}/${role.key}`).set(owner.auth).expect(409);
    expect(res.body.message).toMatch(/still assigned to 1 administrator/);
    expect(await rolesOf(holder.id)).toEqual([role.key]);
  });

  it('validates input and unknown keys', async () => {
    const owner = await adminAuth(ctx, ['super_admin']);
    for (const bad of [
      { name: 'X', permissions: ['users.view'] },
      { name: 'Valid', permissions: [] },
      { name: 'Valid', permissions: ['not.a.permission'] },
      { name: 'Valid', permissions: ['permissions.manage'] },
      { name: 'Valid', permissions: ['users.view'], isSystem: true },
    ]) {
      await ctx.http().post(ROLES).set(owner.auth).send(bad).expect(422);
    }
    await ctx.http().get(`${ROLES}/Nope!`).set(owner.auth).expect(404);
    await ctx.http().get(`${ROLES}/custom_missing`).set(owner.auth).expect(404);
    await ctx
      .http()
      .patch(`${ROLES}/custom_missing`)
      .set(owner.auth)
      .send({ name: 'Ok' })
      .expect(404);
  });

  it('needs roles.manage', async () => {
    for (const role of ['admin', 'finance_admin', 'support_admin']) {
      const auth = (await adminAuth(ctx, [role])).auth;
      await ctx.http().get(ROLES).set(auth).expect(403);
      await ctx.http().post(ROLES).set(auth).send(HR).expect(403);
    }
    expect(await ctx.prisma.role.count({ where: { isSystem: false } })).toBe(0);
  });
});

describe('role assignment safety', () => {
  it('never removes the last active Super Admin', async () => {
    const owner = await adminAuth(ctx, ['super_admin']);
    // A custom role with every permission is still not "Super Admin".
    const everything = await createRole(owner.auth, {
      name: 'Everything',
      permissions: PERMISSION_KEYS,
    });
    const power = await adminAuth(ctx, []);
    await assign(owner.auth, power.id, [everything.key]).expect(200);

    const res = await assign(power.auth, owner.id, [everything.key]).expect(409);
    expect(res.body.message).toMatch(/At least one active Super Admin/);
    expect(await rolesOf(owner.id)).toEqual(['super_admin']);

    // A blocked Super Admin does not count as the remaining one.
    const second = await createAdmin(ctx, ['super_admin']);
    await ctx.prisma.user.update({ where: { id: second.id }, data: { status: 'BLOCKED' } });
    await assign(power.auth, owner.id, []).expect(409);

    await ctx.prisma.user.update({ where: { id: second.id }, data: { status: 'ACTIVE' } });
    await assign(power.auth, owner.id, []).expect(200);
    expect(await rolesOf(owner.id)).toEqual([]);
  });

  it('two Super Admins demoting each other at once cannot both succeed', async () => {
    const a = await adminAuth(ctx, ['super_admin']);
    const b = await adminAuth(ctx, ['super_admin']);
    const [one, two] = await Promise.all([assign(a.auth, b.id, []), assign(b.auth, a.id, [])]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    const remaining = await ctx.prisma.userRole.count({ where: { role: { key: 'super_admin' } } });
    expect(remaining).toBe(1);
  });

  it('serialises concurrent edits of one role (no merged or duplicated permissions)', async () => {
    const owner = await adminAuth(ctx, ['super_admin']);
    const role = await createRole(owner.auth, { name: 'Ops', permissions: ['users.view'] });
    const sets = [
      ['agents.view', 'agents.verify'],
      ['bookings.view', 'payments.view', 'audit.view'],
    ];
    const results = await Promise.all(
      [...sets, ...sets].map((permissions) =>
        ctx.http().patch(`${ROLES}/${role.key}`).set(owner.auth).send({ permissions }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const final = await ctx.prisma.rolePermission.findMany({
      where: { role: { key: role.key } },
      include: { permission: true },
    });
    const keys = final.map((p) => p.permission.key).sort();
    expect(sets.map((s) => [...s].sort())).toContainEqual(keys);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'rbac.role.updated', resourceId: role.key },
      }),
    ).toBe(4);
  });

  it('a role cannot be both deleted and assigned by concurrent requests', async () => {
    const owner = await adminAuth(ctx, ['super_admin']);
    const target = await createAdmin(ctx, []);
    for (let i = 0; i < 3; i++) {
      const role = await createRole(owner.auth, { name: `Race ${i}`, permissions: ['users.view'] });
      const [del, put] = await Promise.all([
        ctx.http().delete(`${ROLES}/${role.key}`).set(owner.auth),
        assign(owner.auth, target.id, [role.key]),
      ]);
      const outcome = [del.status, put.status];
      expect([
        [200, 400],
        [409, 200],
      ]).toContainEqual(outcome);
      const exists = await ctx.prisma.role.count({ where: { key: role.key } });
      expect(exists).toBe(outcome[0] === 200 ? 0 : 1);
      await assign(owner.auth, target.id, []);
    }
  });

  it('commits a role change and its audit entry together', async () => {
    const owner = await adminAuth(ctx, ['super_admin']);
    const target = await createAdmin(ctx, ['content_manager']);
    const audit = ctx.app.get(AuditService);
    const original = audit.record.bind(audit);
    const spy = vi
      .spyOn(audit, 'record')
      .mockImplementation((entry, db) =>
        entry.action === 'user.roles.updated' || entry.action === 'rbac.role.created'
          ? Promise.reject(new Error('audit storage unavailable'))
          : original(entry, db),
      );
    try {
      await assign(owner.auth, target.id, ['finance_admin']).expect(500);
      await ctx.http().post(ROLES).set(owner.auth).send(HR).expect(500);
    } finally {
      spy.mockRestore();
    }
    // Nothing changed without its audit entry.
    expect(await rolesOf(target.id)).toEqual(['content_manager']);
    expect(await ctx.prisma.role.count({ where: { isSystem: false } })).toBe(0);

    await assign(owner.auth, target.id, ['finance_admin']).expect(200);
    const entry = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'user.roles.updated', resourceId: target.id },
    });
    expect(entry).toMatchObject({
      actorId: owner.id,
      before: { roles: ['content_manager'] },
      after: { roles: ['finance_admin'] },
    });
  });
});
