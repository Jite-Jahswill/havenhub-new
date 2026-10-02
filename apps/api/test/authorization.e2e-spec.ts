import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  bearer,
  createAdmin,
  createTestContext,
  expectNoSecrets,
  loginToken,
  registerAgent,
  registerCustomer,
  type TestContext,
} from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const ADMIN_ENDPOINTS = [
  ['get', '/api/v1/admin/overview'],
  ['get', '/api/v1/admin/users'],
  ['get', '/api/v1/admin/agents'],
  ['get', '/api/v1/admin/rbac/roles'],
  ['get', '/api/v1/admin/audit-logs'],
] as const;

describe('account-type boundaries', () => {
  it.each(ADMIN_ENDPOINTS)('a customer cannot %s %s', async (method, path) => {
    const { tokens } = await loginToken(ctx, await registerCustomer(ctx));
    const res = await ctx.http()[method](path).set(bearer(tokens.accessToken)).expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it.each(ADMIN_ENDPOINTS)('an agent cannot %s %s', async (method, path) => {
    const { tokens } = await loginToken(ctx, await registerAgent(ctx));
    await ctx.http()[method](path).set(bearer(tokens.accessToken)).expect(403);
  });

  it('a customer cannot use agent endpoints', async () => {
    const { tokens } = await loginToken(ctx, await registerCustomer(ctx));
    await ctx.http().get('/api/v1/agents/me').set(bearer(tokens.accessToken)).expect(403);
    await ctx
      .http()
      .put('/api/v1/agents/me/identity')
      .set(bearer(tokens.accessToken))
      .send({ nin: '12345678901', idDocumentType: 'NIN_SLIP' })
      .expect(403);
  });

  it('an admin account without roles has no permissions', async () => {
    const { tokens } = await loginToken(ctx, await createAdmin(ctx, []));
    const res = await ctx
      .http()
      .get('/api/v1/admin/users')
      .set(bearer(tokens.accessToken))
      .expect(403);
    expect(res.body.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('roles attached to a non-admin account grant nothing', async () => {
    const creds = await registerCustomer(ctx);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: creds.email } });
    const role = await ctx.prisma.role.findUniqueOrThrow({ where: { key: 'super_admin' } });
    await ctx.prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

    const { tokens, user: me } = await loginToken(ctx, creds);
    expect(me.permissions).toEqual([]);
    await ctx.http().get('/api/v1/admin/users').set(bearer(tokens.accessToken)).expect(403);
  });
});

describe('permission enforcement', () => {
  it('a support admin can view users but not verify agents or manage roles', async () => {
    const { tokens } = await loginToken(ctx, await createAdmin(ctx, ['support_admin']));
    const agent = await registerAgent(ctx);
    const profile = await ctx.prisma.agentProfile.findFirstOrThrow({
      where: { user: { email: agent.email } },
    });

    await ctx.http().get('/api/v1/admin/users').set(bearer(tokens.accessToken)).expect(200);
    await ctx.http().get('/api/v1/admin/agents').set(bearer(tokens.accessToken)).expect(200);
    const verify = await ctx
      .http()
      .patch(`/api/v1/admin/agents/${profile.id}/verification`)
      .set(bearer(tokens.accessToken))
      .send({ status: 'UNDER_REVIEW' })
      .expect(403);
    expect(verify.body.code).toBe('INSUFFICIENT_PERMISSIONS');
    await ctx.http().get('/api/v1/admin/rbac/roles').set(bearer(tokens.accessToken)).expect(403);
    await ctx.http().get('/api/v1/admin/audit-logs').set(bearer(tokens.accessToken)).expect(403);
  });

  it('a content manager cannot see users at all', async () => {
    const { tokens } = await loginToken(ctx, await createAdmin(ctx, ['content_manager']));
    await ctx.http().get('/api/v1/admin/users').set(bearer(tokens.accessToken)).expect(403);
  });

  it('permissions are re-read on every request, so revoking a role takes effect immediately', async () => {
    const admin = await createAdmin(ctx, ['support_admin']);
    const { tokens } = await loginToken(ctx, admin);
    await ctx.http().get('/api/v1/admin/users').set(bearer(tokens.accessToken)).expect(200);
    await ctx.prisma.userRole.deleteMany({ where: { userId: admin.id } });
    await ctx.http().get('/api/v1/admin/users').set(bearer(tokens.accessToken)).expect(403);
  });

  it('admin user listings never include password hashes', async () => {
    await registerCustomer(ctx);
    const { tokens } = await loginToken(ctx, await createAdmin(ctx, ['super_admin']));
    const res = await ctx
      .http()
      .get('/api/v1/admin/users')
      .set(bearer(tokens.accessToken))
      .expect(200);
    expect(res.body.data.total).toBe(2);
    expectNoSecrets(res.body);
  });
});

describe('role escalation', () => {
  it('only a super admin can assign roles', async () => {
    const target = await createAdmin(ctx, []);
    const admin = await loginToken(ctx, await createAdmin(ctx, ['admin']));
    await ctx
      .http()
      .put(`/api/v1/admin/users/${target.id}/roles`)
      .set(bearer(admin.tokens.accessToken))
      .send({ roleKeys: ['super_admin'] })
      .expect(403);

    const superAdmin = await loginToken(ctx, await createAdmin(ctx, ['super_admin']));
    const res = await ctx
      .http()
      .put(`/api/v1/admin/users/${target.id}/roles`)
      .set(bearer(superAdmin.tokens.accessToken))
      .send({ roleKeys: ['finance_admin'] })
      .expect(200);
    expect(res.body.data.roles).toEqual(['finance_admin']);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'user.roles.updated' } })).toBe(1);
  });

  it('nobody can change their own roles', async () => {
    const creds = await createAdmin(ctx, ['super_admin']);
    const { tokens } = await loginToken(ctx, creds);
    await ctx
      .http()
      .put(`/api/v1/admin/users/${creds.id}/roles`)
      .set(bearer(tokens.accessToken))
      .send({ roleKeys: [] })
      .expect(403);
  });

  it('roles cannot be given to customers or agents', async () => {
    const customer = await registerCustomer(ctx);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: customer.email } });
    const { tokens } = await loginToken(ctx, await createAdmin(ctx, ['super_admin']));
    await ctx
      .http()
      .put(`/api/v1/admin/users/${user.id}/roles`)
      .set(bearer(tokens.accessToken))
      .send({ roleKeys: ['admin'] })
      .expect(400);
  });

  it('a non-super admin cannot block another admin', async () => {
    const victim = await createAdmin(ctx, ['super_admin']);
    const { tokens } = await loginToken(ctx, await createAdmin(ctx, ['support_admin']));
    await ctx
      .http()
      .patch(`/api/v1/admin/users/${victim.id}/status`)
      .set(bearer(tokens.accessToken))
      .send({ status: 'BLOCKED' })
      .expect(403);
  });
});

describe('account status', () => {
  it('blocking a user ends their sessions and prevents login', async () => {
    const creds = await registerCustomer(ctx);
    const customer = await loginToken(ctx, creds);
    const { tokens } = await loginToken(ctx, await createAdmin(ctx, ['support_admin']));

    await ctx
      .http()
      .patch(`/api/v1/admin/users/${customer.user.id}/status`)
      .set(bearer(tokens.accessToken))
      .send({ status: 'BLOCKED', reason: 'Fraud report' })
      .expect(200);

    await ctx.http().get('/api/v1/auth/me').set(bearer(customer.tokens.accessToken)).expect(401);
    const login = await ctx.http().post('/api/v1/auth/login').send(creds).expect(403);
    expect(login.body.code).toBe('ACCOUNT_BLOCKED');
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'user.status.updated' },
    });
    expect(audit.resourceId).toBe(customer.user.id);
  });

  it('an admin cannot change their own status', async () => {
    const creds = await createAdmin(ctx, ['super_admin']);
    const { tokens } = await loginToken(ctx, creds);
    await ctx
      .http()
      .patch(`/api/v1/admin/users/${creds.id}/status`)
      .set(bearer(tokens.accessToken))
      .send({ status: 'SUSPENDED' })
      .expect(403);
  });
});

describe('private data isolation between customers', () => {
  it("a customer cannot read or revoke another customer's sessions", async () => {
    const alice = await loginToken(ctx, await registerCustomer(ctx));
    const bob = await loginToken(ctx, await registerCustomer(ctx));
    const bobSessions = await ctx
      .http()
      .get('/api/v1/auth/sessions')
      .set(bearer(bob.tokens.accessToken))
      .expect(200);
    const bobSessionId = bobSessions.body.data[0].id;

    const aliceSessions = await ctx
      .http()
      .get('/api/v1/auth/sessions')
      .set(bearer(alice.tokens.accessToken))
      .expect(200);
    expect(aliceSessions.body.data.map((s: { id: string }) => s.id)).not.toContain(bobSessionId);

    await ctx
      .http()
      .delete(`/api/v1/auth/sessions/${bobSessionId}`)
      .set(bearer(alice.tokens.accessToken))
      .expect(404);
    await ctx.http().get('/api/v1/auth/me').set(bearer(bob.tokens.accessToken)).expect(200);
  });

  it('profile endpoints only ever return and modify the caller', async () => {
    const alice = await loginToken(ctx, await registerCustomer(ctx));
    const bob = await loginToken(ctx, await registerCustomer(ctx));
    const res = await ctx
      .http()
      .patch('/api/v1/users/me')
      .set(bearer(alice.tokens.accessToken))
      .send({ fullName: 'Alice Updated', id: bob.user.id })
      .expect(200);
    expect(res.body.data.id).toBe(alice.user.id);
    const bobUser = await ctx.prisma.user.findUniqueOrThrow({ where: { id: bob.user.id } });
    expect(bobUser.fullName).toBe('Chiamaka Okafor');
  });

  it('there is no generic /users/:id endpoint', async () => {
    const alice = await loginToken(ctx, await registerCustomer(ctx));
    const bob = await loginToken(ctx, await registerCustomer(ctx));
    await ctx
      .http()
      .get(`/api/v1/users/${bob.user.id}`)
      .set(bearer(alice.tokens.accessToken))
      .expect(404);
  });
});
