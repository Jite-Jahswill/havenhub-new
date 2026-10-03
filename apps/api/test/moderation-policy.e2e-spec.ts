import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminAuth } from './helpers/booking-helpers';
import {
  createAgent,
  createDraft,
  createPublished,
  createTestContext,
  testImage,
  uploadImage,
  type Agent,
  type TestContext,
} from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const POLICY = '/api/v1/admin/settings/moderation';
const superAdmin = async () => (await adminAuth(ctx, ['super_admin'])).auth;

async function setPolicy(policy: Record<string, boolean>, auth?: Record<string, string>) {
  const res = await ctx
    .http()
    .patch(POLICY)
    .set(auth ?? (await superAdmin()))
    .send(policy);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as { moderation: Record<string, boolean> };
}

const submitProperty = (agent: Agent, id: string) =>
  ctx.http().post(`/api/v1/agents/me/properties/${id}/submit`).set(agent.auth);

async function cleaningDraft(agent: Agent) {
  const res = await ctx
    .http()
    .post('/api/v1/agents/me/experiences')
    .set(agent.auth)
    .send({
      kind: 'CLEANING',
      title: 'Sparkle home cleaning',
      description: 'Thorough home and apartment cleaning by a vetted, insured team of cleaners.',
      city: 'Ikeja',
      state: 'Lagos',
      cleaning: { priceKobo: 2_000_000, serviceAreas: ['Ikeja'], availableDays: ['MON'] },
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const id = (res.body.data as { id: string }).id;
  await ctx
    .http()
    .post(`/api/v1/agents/me/experiences/${id}/images`)
    .set(agent.auth)
    .attach('file', await testImage(), { filename: 'photo.jpg', contentType: 'image/jpeg' })
    .expect(201);
  return id;
}

describe('moderation policy', () => {
  it('requires review for every listing type by default', async () => {
    const res = await ctx
      .http()
      .get(POLICY)
      .set(await superAdmin())
      .expect(200);
    expect(res.body.data.moderation).toEqual({
      PROPERTY: true,
      EVENT: true,
      TOUR: true,
      HOTEL: true,
      CLEANING: true,
    });
    const agent = await createAgent(ctx);
    const draft = await createDraft(ctx, agent);
    await uploadImage(ctx, agent, draft.id);
    const submitted = await submitProperty(agent, draft.id).expect(200);
    expect(submitted.body.data.status).toBe('PENDING_REVIEW');
  });

  it('can publish properties without review, and the change is audited and reversible', async () => {
    const admin = await adminAuth(ctx, ['super_admin']);
    const after = await setPolicy({ PROPERTY: false }, admin.auth);
    expect(after.moderation).toMatchObject({ PROPERTY: false, EVENT: true });

    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'platform.moderation_policy.updated' },
    });
    expect(audit).toMatchObject({ actorId: admin.id, resourceType: 'platform_settings' });
    expect(audit.before).toMatchObject({ PROPERTY: true });
    expect(audit.after).toMatchObject({ PROPERTY: false });

    // Submission now publishes immediately (still only for verified agents).
    const agent = await createAgent(ctx);
    const draft = await createDraft(ctx, agent);
    await uploadImage(ctx, agent, draft.id);
    const res = await submitProperty(agent, draft.id).expect(200);
    expect(res.body.data.status).toBe('PUBLISHED');
    const row = await ctx.prisma.property.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.publishedAt).not.toBeNull();
    expect(row.reviewerId).toBeNull();
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'property.published_without_review', resourceId: draft.id },
      }),
    ).toBe(1);
    await ctx.http().get(`/api/v1/properties/${draft.slug}`).expect(200);

    // Editing a live listing keeps it live while review is off.
    const edited = await ctx
      .http()
      .patch(`/api/v1/agents/me/properties/${draft.id}`)
      .set(agent.auth)
      .send({ title: 'Updated bright apartment in Lekki' })
      .expect(200);
    expect(edited.body.data.status).toBe('PUBLISHED');

    // Switching review back on applies to the next submission.
    await setPolicy({ PROPERTY: true }, admin.auth);
    const otherAgent = await createAgent(ctx);
    const second = await createDraft(ctx, otherAgent);
    await uploadImage(ctx, otherAgent, second.id);
    expect((await submitProperty(otherAgent, second.id).expect(200)).body.data.status).toBe(
      'PENDING_REVIEW',
    );
    // …and editing a live listing sends it back to review again.
    const again = await ctx
      .http()
      .patch(`/api/v1/agents/me/properties/${draft.id}`)
      .set(agent.auth)
      .send({ title: 'Bright apartment in Lekki, again' })
      .expect(200);
    expect(again.body.data.status).toBe('PENDING_REVIEW');
  });

  it('applies per listing type (cleaning off, properties still reviewed)', async () => {
    await setPolicy({ CLEANING: false });
    const agent = await createAgent(ctx);
    const id = await cleaningDraft(agent);
    const res = await ctx
      .http()
      .post(`/api/v1/agents/me/experiences/${id}/submit`)
      .set(agent.auth)
      .expect(200);
    expect(res.body.data.status).toBe('PUBLISHED');
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'experience.published_without_review', resourceId: id },
      }),
    ).toBe(1);

    const draft = await createDraft(ctx, agent);
    await uploadImage(ctx, agent, draft.id);
    expect((await submitProperty(agent, draft.id).expect(200)).body.data.status).toBe(
      'PENDING_REVIEW',
    );
  });

  it('existing listings keep their state when the policy changes', async () => {
    const agent = await createAgent(ctx);
    const pending = await createDraft(ctx, agent);
    await uploadImage(ctx, agent, pending.id);
    await submitProperty(agent, pending.id).expect(200);
    const live = await createPublished(ctx, await createAgent(ctx));

    await setPolicy({ PROPERTY: false });
    const statuses = await ctx.prisma.property.findMany({
      where: { id: { in: [pending.id, live.id] } },
      select: { id: true, status: true },
    });
    expect(Object.fromEntries(statuses.map((s) => [s.id, s.status]))).toEqual({
      [pending.id]: 'PENDING_REVIEW',
      [live.id]: 'PUBLISHED',
    });
  });

  it('only settings.manage may read or change the policy; input is validated', async () => {
    for (const role of ['admin', 'property_manager', 'operations_manager']) {
      const auth = (await adminAuth(ctx, [role])).auth;
      await ctx.http().get(POLICY).set(auth).expect(403);
      await ctx.http().patch(POLICY).set(auth).send({ PROPERTY: false }).expect(403);
    }
    const agent = await createAgent(ctx);
    await ctx.http().patch(POLICY).set(agent.auth).send({ PROPERTY: false }).expect(403);
    await ctx.http().patch(POLICY).send({ PROPERTY: false }).expect(401);

    const auth = await superAdmin();
    for (const bad of [{}, { PROPERTY: 'no' }, { SALES: false }]) {
      await ctx.http().patch(POLICY).set(auth).send(bad).expect(422);
    }
    expect(
      await ctx.prisma.auditLog.count({ where: { action: { startsWith: 'platform.' } } }),
    ).toBe(0);
    const row = await ctx.prisma.platformSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(row.reviewProperties).toBe(true);
  });
});
