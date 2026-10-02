import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  bearer,
  createAdmin,
  createTestContext,
  expectNoSecrets,
  loginToken,
  registerAgent,
  type TestContext,
} from './helpers/test-app';

const NIN = '12345678901';
const ACCOUNT_NUMBER = '0123456789';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

async function completeAgent(nin = NIN) {
  const creds = await registerAgent(ctx);
  const { tokens, user } = await loginToken(ctx, creds);
  const auth = bearer(tokens.accessToken);
  await ctx
    .http()
    .patch('/api/v1/agents/me')
    .set(auth)
    .send({ addressLine: '12 Admiralty Way', city: 'Lekki', lga: 'Eti-Osa', state: 'Lagos' })
    .expect(200);
  await ctx
    .http()
    .put('/api/v1/agents/me/identity')
    .set(auth)
    .send({ nin, idDocumentType: 'NIN_SLIP' })
    .expect(200);
  await ctx
    .http()
    .put('/api/v1/agents/me/payout-account')
    .set(auth)
    .send({
      bankName: 'GTBank',
      bankCode: '058',
      accountNumber: ACCOUNT_NUMBER,
      accountName: 'Tunde Bakare',
    })
    .expect(200);
  const profile = await ctx.prisma.agentProfile.findUniqueOrThrow({ where: { userId: user.id } });
  return { creds, auth, userId: user.id, profileId: profile.id };
}

describe('agent profile', () => {
  it('stores the NIN and account number encrypted and only returns them masked', async () => {
    const { auth, userId } = await completeAgent();
    const res = await ctx.http().get('/api/v1/agents/me').set(auth).expect(200);
    expect(res.body.data.identity).toEqual({
      submitted: true,
      idDocumentType: 'NIN_SLIP',
      ninMasked: '•••••••8901',
    });
    expect(res.body.data.payoutAccount.accountNumberMasked).toBe('••••••6789');
    expectNoSecrets(res.body, [NIN, ACCOUNT_NUMBER]);

    const row = await ctx.prisma.agentProfile.findUniqueOrThrow({
      where: { userId },
      include: { payoutAccount: true },
    });
    expect(row.ninCiphertext).toMatch(/^v1\./);
    expect(row.ninCiphertext).not.toContain(NIN);
    expect(row.payoutAccount!.accountNumberCiphertext).not.toContain(ACCOUNT_NUMBER);
  });

  it('rejects a NIN already linked to another account', async () => {
    await completeAgent();
    const other = await loginToken(ctx, await registerAgent(ctx));
    const res = await ctx
      .http()
      .put('/api/v1/agents/me/identity')
      .set(bearer(other.tokens.accessToken))
      .send({ nin: NIN, idDocumentType: 'NIN_SLIP' })
      .expect(409);
    expectNoSecrets(res.body, [NIN]);
  });

  it('cannot submit for verification while incomplete', async () => {
    const { tokens } = await loginToken(ctx, await registerAgent(ctx));
    const res = await ctx
      .http()
      .post('/api/v1/agents/me/verification')
      .set(bearer(tokens.accessToken))
      .expect(422);
    expect(res.body.code).toBe('AGENT_PROFILE_INCOMPLETE');
    expect(res.body.details.missing).toEqual(expect.arrayContaining(['addressLine', 'identity']));
  });

  it('locks identity details once submitted for review', async () => {
    const { auth } = await completeAgent();
    await ctx.http().post('/api/v1/agents/me/verification').set(auth).expect(200);
    await ctx
      .http()
      .put('/api/v1/agents/me/identity')
      .set(auth)
      .send({ nin: '10987654321', idDocumentType: 'NIN_SLIP' })
      .expect(409);
  });

  it('tracks onboarding progress and can be dismissed', async () => {
    const { auth } = await completeAgent();
    const before = await ctx.http().get('/api/v1/agents/me/onboarding').set(auth).expect(200);
    expect(before.body.data.completedCount).toBe(2); // profile + payout; identity counts once submitted
    await ctx.http().post('/api/v1/agents/me/verification').set(auth).expect(200);
    const after = await ctx
      .http()
      .post('/api/v1/agents/me/onboarding/dismiss')
      .set(auth)
      .expect(200);
    expect(after.body.data.completedCount).toBe(3);
    expect(after.body.data.dismissed).toBe(true);
  });

  it('shows the free plan allowance', async () => {
    const { tokens } = await loginToken(ctx, await registerAgent(ctx));
    const res = await ctx
      .http()
      .get('/api/v1/agents/me/plan')
      .set(bearer(tokens.accessToken))
      .expect(200);
    expect(res.body.data.usage).toEqual([
      { key: 'properties', label: 'Active properties', used: 0, limit: 1 },
      { key: 'images', label: 'Images per property', used: null, limit: 10 },
      { key: 'videos', label: 'Videos per property', used: null, limit: 1 },
    ]);
  });

  it('always requires a verified email for sensitive agent actions', async () => {
    const relaxed = await createTestContext({ REQUIRE_EMAIL_VERIFICATION: false });
    try {
      // With verification relaxed, an unverified agent may sign in…
      const creds = await registerAgent(relaxed, { verify: false });
      const { tokens } = await loginToken(relaxed, creds);
      const auth = bearer(tokens.accessToken);
      await relaxed.http().get('/api/v1/agents/me').set(auth).expect(200);
      // …but cannot submit identity or payout details.
      const identity = await relaxed
        .http()
        .put('/api/v1/agents/me/identity')
        .set(auth)
        .send({ nin: '55555555555', idDocumentType: 'NIN_SLIP' })
        .expect(403);
      expect(identity.body.code).toBe('EMAIL_NOT_VERIFIED');
      await relaxed
        .http()
        .put('/api/v1/agents/me/payout-account')
        .set(auth)
        .send({
          bankName: 'GTBank',
          bankCode: '058',
          accountNumber: ACCOUNT_NUMBER,
          accountName: 'T B',
        })
        .expect(403);
    } finally {
      await relaxed.close();
    }
  });
});

describe('verification workflow', () => {
  it('moves from submission to verified and becomes publicly visible', async () => {
    const { auth, profileId } = await completeAgent();

    // Not public before verification.
    await ctx.http().get(`/api/v1/agents/${profileId}`).expect(404);

    await ctx.http().post('/api/v1/agents/me/verification').set(auth).expect(200);
    const admin = await loginToken(ctx, await createAdmin(ctx, ['operations_manager']));
    const res = await ctx
      .http()
      .patch(`/api/v1/admin/agents/${profileId}/verification`)
      .set(bearer(admin.tokens.accessToken))
      .send({ status: 'VERIFIED' })
      .expect(200);
    expect(res.body.data.verificationStatus).toBe('VERIFIED');
    expectNoSecrets(res.body, [NIN, ACCOUNT_NUMBER]);

    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'agent.verification.updated' },
    });
    expect(audit.actorId).toBe(admin.user.id);
    expect(audit.after).toMatchObject({ status: 'VERIFIED' });
  });

  it('cannot skip review', async () => {
    const { profileId } = await completeAgent();
    const admin = await loginToken(ctx, await createAdmin(ctx, ['operations_manager']));
    const res = await ctx
      .http()
      .patch(`/api/v1/admin/agents/${profileId}/verification`)
      .set(bearer(admin.tokens.accessToken))
      .send({ status: 'VERIFIED' })
      .expect(409);
    expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('requires a reason to reject, and lets the agent resubmit', async () => {
    const { auth, profileId } = await completeAgent();
    await ctx.http().post('/api/v1/agents/me/verification').set(auth).expect(200);
    const admin = await loginToken(ctx, await createAdmin(ctx, ['operations_manager']));
    const url = `/api/v1/admin/agents/${profileId}/verification`;
    await ctx
      .http()
      .patch(url)
      .set(bearer(admin.tokens.accessToken))
      .send({ status: 'REJECTED' })
      .expect(422);
    await ctx
      .http()
      .patch(url)
      .set(bearer(admin.tokens.accessToken))
      .send({ status: 'REJECTED', note: 'ID photo unreadable' })
      .expect(200);

    const me = await ctx.http().get('/api/v1/agents/me').set(auth).expect(200);
    expect(me.body.data.verificationStatus).toBe('REJECTED');
    expect(me.body.data.verificationNote).toBe('ID photo unreadable');
    await ctx.http().post('/api/v1/agents/me/verification').set(auth).expect(200);
  });

  it('suspending needs agents.suspend, not just agents.verify', async () => {
    const { profileId } = await completeAgent();
    const role = await ctx.prisma.role.create({
      data: {
        key: 'verifier_only',
        name: 'Verifier',
        permissions: {
          create: await ctx.prisma.permission
            .findMany({ where: { key: { in: ['agents.view', 'agents.verify'] } } })
            .then((ps) => ps.map((p) => ({ permissionId: p.id }))),
        },
      },
    });
    const admin = await loginToken(ctx, await createAdmin(ctx, [role.key]));
    await ctx
      .http()
      .patch(`/api/v1/admin/agents/${profileId}/verification`)
      .set(bearer(admin.tokens.accessToken))
      .send({ status: 'SUSPENDED' })
      .expect(403);
    await ctx.prisma.role.delete({ where: { id: role.id } });
  });
});

describe('sensitive data exposure', () => {
  it('the public profile contains no identity, contact or bank data', async () => {
    const { auth, profileId, creds } = await completeAgent();
    await ctx.http().post('/api/v1/agents/me/verification').set(auth).expect(200);
    const admin = await loginToken(ctx, await createAdmin(ctx, ['operations_manager']));
    await ctx
      .http()
      .patch(`/api/v1/admin/agents/${profileId}/verification`)
      .set(bearer(admin.tokens.accessToken))
      .send({ status: 'VERIFIED' })
      .expect(200);

    const res = await ctx.http().get(`/api/v1/agents/${profileId}`).expect(200);
    expect(res.body.data).toEqual({
      id: profileId,
      displayName: 'Tunde Bakare',
      avatarUrl: null,
      serviceTypes: ['LANDLORD'],
      city: 'Lekki',
      state: 'Lagos',
      verified: true,
      memberSince: expect.any(String),
      publishedPropertyCount: 0,
    });
    expectNoSecrets(res.body, [NIN, ACCOUNT_NUMBER, '8901', '6789', creds.email, '+234']);
  });

  it("an agent cannot reach another agent's private data", async () => {
    const alice = await completeAgent();
    const bob = await loginToken(ctx, await registerAgent(ctx));
    const bobAuth = bearer(bob.tokens.accessToken);

    // /agents/me is always the caller.
    const me = await ctx.http().get('/api/v1/agents/me').set(bobAuth).expect(200);
    expect(me.body.data.id).not.toBe(alice.profileId);
    expect(me.body.data.identity.submitted).toBe(false);

    // The id-based route only serves verified public profiles, and admin routes are closed.
    await ctx.http().get(`/api/v1/agents/${alice.profileId}`).set(bobAuth).expect(404);
    await ctx.http().get(`/api/v1/admin/agents/${alice.profileId}`).set(bobAuth).expect(403);
  });

  it('admin review shows masked values only', async () => {
    const { profileId } = await completeAgent();
    const admin = await loginToken(ctx, await createAdmin(ctx, ['super_admin']));
    const res = await ctx
      .http()
      .get(`/api/v1/admin/agents/${profileId}`)
      .set(bearer(admin.tokens.accessToken))
      .expect(200);
    expect(res.body.data.profile.identity.ninMasked).toBe('•••••••8901');
    expectNoSecrets(res.body, [NIN, ACCOUNT_NUMBER]);
  });
});
