import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  bearer,
  completeProperty,
  createAdmin,
  createAgent,
  createDraft,
  createPublished,
  createTestContext,
  loginToken,
  moderatorAuth,
  registerCustomer,
  uploadImage,
  type TestContext,
} from './helpers/test-app';

let ctx: TestContext;
const BASE = '/api/v1/agents/me/properties';

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

describe('creating properties', () => {
  it('a verified agent creates a draft owned by them', async () => {
    const agent = await createAgent(ctx);
    const draft = await createDraft(ctx, agent);
    expect(draft.status).toBe('DRAFT');
    expect(draft.slug).toMatch(/^bright-3-bedroom-apartment-in-lekki-[0-9a-f]{6}$/);
    const row = await ctx.prisma.property.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.agentProfileId).toBe(agent.agentProfileId);
    expect(row.priceKobo).toBe(450_000_000n);
  });

  it('saves a minimal draft and reports what is missing', async () => {
    const agent = await createAgent(ctx);
    const res = await ctx
      .http()
      .post(BASE)
      .set(agent.auth)
      .send({ title: 'Plot of land', propertyType: 'LAND', listingType: 'SALE' })
      .expect(201);
    expect(res.body.data.pricingPeriod).toBe('SALE');
    expect(res.body.data.missingForSubmission).toEqual(
      expect.arrayContaining(['description', 'priceKobo', 'location', 'images']),
    );
  });

  it('rejects inconsistent pricing', async () => {
    const agent = await createAgent(ctx);
    const res = await ctx
      .http()
      .post(BASE)
      .set(agent.auth)
      .send(completeProperty({ listingType: 'SALE', pricingPeriod: 'MONTHLY' }))
      .expect(422);
    expect(res.body.details.issues[0].path).toBe('pricingPeriod');
  });

  it('rejects coordinates outside Nigeria', async () => {
    const agent = await createAgent(ctx);
    await ctx
      .http()
      .post(BASE)
      .set(agent.auth)
      .send(completeProperty({ latitude: 51.5, longitude: -0.12 }))
      .expect(422);
  });

  it('[1] a customer cannot create properties', async () => {
    const { tokens } = await loginToken(ctx, await registerCustomer(ctx));
    await ctx
      .http()
      .post(BASE)
      .set(bearer(tokens.accessToken))
      .send(completeProperty())
      .expect(403);
    expect(await ctx.prisma.property.count()).toBe(0);
  });

  it('[7] unauthenticated users cannot reach property management', async () => {
    await ctx.http().get(BASE).expect(401);
    await ctx.http().post(BASE).send(completeProperty()).expect(401);
    await ctx.http().get('/api/v1/admin/properties').expect(401);
  });

  it('[10] ownership and status cannot be injected', async () => {
    const victim = await createAgent(ctx);
    const attacker = await createAgent(ctx);
    const res = await ctx
      .http()
      .post(BASE)
      .set(attacker.auth)
      .send(
        completeProperty({
          agentProfileId: victim.agentProfileId,
          status: 'PUBLISHED',
          slug: 'stolen-slug',
          publishedAt: new Date().toISOString(),
          moderationNote: 'pre-approved',
        }),
      )
      .expect(201);
    const row = await ctx.prisma.property.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.agentProfileId).toBe(attacker.agentProfileId);
    expect(row.status).toBe('DRAFT');
    expect(row.slug).not.toBe('stolen-slug');
    expect(row.publishedAt).toBeNull();

    await ctx
      .http()
      .patch(`${BASE}/${row.id}`)
      .set(attacker.auth)
      .send({
        title: 'Renamed listing',
        agentProfileId: victim.agentProfileId,
        status: 'PUBLISHED',
      })
      .expect(200);
    const after = await ctx.prisma.property.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.agentProfileId).toBe(attacker.agentProfileId);
    expect(after.status).toBe('DRAFT');
  });
});

describe('agent verification requirements', () => {
  it('[2] unverified agents can draft but not submit', async () => {
    const agent = await createAgent(ctx, 'PENDING');
    const draft = await createDraft(ctx, agent);
    await uploadImage(ctx, agent, draft.id);
    const res = await ctx.http().post(`${BASE}/${draft.id}/submit`).set(agent.auth).expect(403);
    expect(res.body.code).toBe('AGENT_NOT_VERIFIED');
  });

  it.each(['SUSPENDED', 'BLOCKED'] as const)(
    '[2] %s agents cannot create or change properties',
    async (status) => {
      const agent = await createAgent(ctx);
      const draft = await createDraft(ctx, agent);
      await ctx.prisma.agentProfile.update({
        where: { id: agent.agentProfileId },
        data: { verificationStatus: status },
      });

      const create = await ctx
        .http()
        .post(BASE)
        .set(agent.auth)
        .send(completeProperty())
        .expect(403);
      expect(create.body.code).toBe('AGENT_RESTRICTED');
      await ctx
        .http()
        .patch(`${BASE}/${draft.id}`)
        .set(agent.auth)
        .send({ title: 'Changed title' })
        .expect(403);
      await ctx.http().post(`${BASE}/${draft.id}/submit`).set(agent.auth).expect(403);
      await uploadImage(ctx, agent, draft.id, 403);
      // They can still see their own listing.
      await ctx.http().get(`${BASE}/${draft.id}`).set(agent.auth).expect(200);
    },
  );

  it('[2] suspending an agent hides their published listings immediately', async () => {
    const agent = await createAgent(ctx);
    const property = await createPublished(ctx, agent);
    await ctx.http().get(`/api/v1/properties/${property.slug}`).expect(200);
    await ctx.prisma.agentProfile.update({
      where: { id: agent.agentProfileId },
      data: { verificationStatus: 'SUSPENDED' },
    });
    await ctx.http().get(`/api/v1/properties/${property.slug}`).expect(404);
    expect((await ctx.http().get('/api/v1/properties').expect(200)).body.data.total).toBe(0);
  });
});

describe('ownership', () => {
  it("[3][4] agent A cannot read or change agent B's property", async () => {
    const a = await createAgent(ctx);
    const b = await createAgent(ctx);
    const bDraft = await createDraft(ctx, b, { title: 'B private draft' });

    await ctx.http().get(`${BASE}/${bDraft.id}`).set(a.auth).expect(404);
    await ctx
      .http()
      .patch(`${BASE}/${bDraft.id}`)
      .set(a.auth)
      .send({ title: 'Hijacked title' })
      .expect(404);
    await ctx.http().post(`${BASE}/${bDraft.id}/submit`).set(a.auth).expect(404);
    await ctx.http().post(`${BASE}/${bDraft.id}/archive`).set(a.auth).expect(404);
    await uploadImage(ctx, a, bDraft.id, 404);
    await ctx
      .http()
      .post(`${BASE}/${bDraft.id}/videos`)
      .set(a.auth)
      .send({ url: 'https://youtu.be/dQw4w9WgXcQ' })
      .expect(404);

    const list = await ctx.http().get(BASE).set(a.auth).expect(200);
    expect(list.body.data).toHaveLength(0);
    const row = await ctx.prisma.property.findUniqueOrThrow({ where: { id: bDraft.id } });
    expect(row.title).toBe('B private draft');
    expect(row.status).toBe('DRAFT');
    expect(await ctx.prisma.propertyImage.count({ where: { propertyId: bDraft.id } })).toBe(0);
  });
});

describe('lifecycle', () => {
  it('cannot submit an incomplete property', async () => {
    const agent = await createAgent(ctx);
    const draft = await createDraft(ctx, agent);
    const res = await ctx.http().post(`${BASE}/${draft.id}/submit`).set(agent.auth).expect(422);
    expect(res.body.code).toBe('PROPERTY_INCOMPLETE');
    expect(res.body.details.missing).toEqual(['images']);
  });

  it('draft → review → rejected → edited → resubmitted → approved, all audited', async () => {
    const agent = await createAgent(ctx);
    const moderator = await moderatorAuth(ctx);
    const draft = await createDraft(ctx, agent);
    await uploadImage(ctx, agent, draft.id);
    await ctx.http().post(`${BASE}/${draft.id}/submit`).set(agent.auth).expect(200);

    // Locked while under review.
    const locked = await ctx
      .http()
      .patch(`${BASE}/${draft.id}`)
      .set(agent.auth)
      .send({ title: 'Mid-review edit' })
      .expect(409);
    expect(locked.body.code).toBe('PROPERTY_LOCKED');

    const moderate = (body: object) =>
      ctx.http().patch(`/api/v1/admin/properties/${draft.id}/moderation`).set(moderator).send(body);
    await moderate({ action: 'REJECT' }).expect(422);
    await moderate({ action: 'REJECT', note: 'Photos are too dark' }).expect(200);

    const rejected = await ctx.http().get(`${BASE}/${draft.id}`).set(agent.auth).expect(200);
    expect(rejected.body.data.status).toBe('REJECTED');
    expect(rejected.body.data.moderationNote).toBe('Photos are too dark');
    await ctx.http().get(`/api/v1/properties/${draft.slug}`).expect(404);

    await ctx
      .http()
      .patch(`${BASE}/${draft.id}`)
      .set(agent.auth)
      .send({ title: 'Brighter 3-bedroom apartment' })
      .expect(200);
    await ctx.http().post(`${BASE}/${draft.id}/submit`).set(agent.auth).expect(200);
    const approved = await moderate({ action: 'APPROVE' }).expect(200);
    expect(approved.body.data.status).toBe('PUBLISHED');

    const slug = approved.body.data.slug as string;
    expect(slug).toMatch(/^brighter-3-bedroom-apartment/);
    await ctx.http().get(`/api/v1/properties/${slug}`).expect(200);

    const actions = (
      await ctx.prisma.auditLog.findMany({
        where: { resourceId: draft.id },
        orderBy: { createdAt: 'asc' },
      })
    ).map((a) => a.action);
    expect(actions).toEqual([
      'property.created',
      'property.image_added',
      'property.submitted',
      'property.moderation.reject',
      'property.updated',
      'property.submitted',
      'property.moderation.approve',
    ]);
  });

  it('editing a published listing sends it back to review and hides it, keeping the slug', async () => {
    const agent = await createAgent(ctx);
    const property = await createPublished(ctx, agent);
    const res = await ctx
      .http()
      .patch(`${BASE}/${property.id}`)
      .set(agent.auth)
      .send({ title: 'New marketing title' })
      .expect(200);
    expect(res.body.data.status).toBe('PENDING_REVIEW');
    expect(res.body.data.slug).toBe(property.slug);
    await ctx.http().get(`/api/v1/properties/${property.slug}`).expect(404);
  });

  it('withdraw, archive and restore', async () => {
    const agent = await createAgent(ctx);
    const draft = await createDraft(ctx, agent);
    await uploadImage(ctx, agent, draft.id);
    await ctx.http().post(`${BASE}/${draft.id}/submit`).set(agent.auth).expect(200);
    expect(
      (await ctx.http().post(`${BASE}/${draft.id}/withdraw`).set(agent.auth).expect(200)).body.data
        .status,
    ).toBe('DRAFT');
    expect(
      (await ctx.http().post(`${BASE}/${draft.id}/archive`).set(agent.auth).expect(200)).body.data
        .status,
    ).toBe('ARCHIVED');
    expect(
      (await ctx.http().post(`${BASE}/${draft.id}/restore`).set(agent.auth).expect(200)).body.data
        .status,
    ).toBe('DRAFT');
  });
});

describe('admin moderation', () => {
  it('suspend and restore a published listing', async () => {
    const agent = await createAgent(ctx);
    const property = await createPublished(ctx, agent);
    const moderator = await moderatorAuth(ctx);
    const url = `/api/v1/admin/properties/${property.id}/moderation`;
    await ctx.http().patch(url).set(moderator).send({ action: 'SUSPEND' }).expect(422);
    await ctx
      .http()
      .patch(url)
      .set(moderator)
      .send({ action: 'SUSPEND', note: 'Reported as unavailable' })
      .expect(200);
    await ctx.http().get(`/api/v1/properties/${property.slug}`).expect(404);
    // The agent cannot edit or archive a suspended listing.
    await ctx
      .http()
      .patch(`${BASE}/${property.id}`)
      .set(agent.auth)
      .send({ title: 'Trying to edit' })
      .expect(409);
    await ctx.http().post(`${BASE}/${property.id}/archive`).set(agent.auth).expect(409);
    await ctx.http().patch(url).set(moderator).send({ action: 'RESTORE' }).expect(200);
    await ctx.http().get(`/api/v1/properties/${property.slug}`).expect(200);
  });

  it('cannot approve properties that are not awaiting review', async () => {
    const agent = await createAgent(ctx);
    const draft = await createDraft(ctx, agent);
    const res = await ctx
      .http()
      .patch(`/api/v1/admin/properties/${draft.id}/moderation`)
      .set(await moderatorAuth(ctx))
      .send({ action: 'APPROVE' })
      .expect(409);
    expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[12] moderation endpoints require the right permissions', async () => {
    const agent = await createAgent(ctx);
    const draft = await createDraft(ctx, agent);
    await uploadImage(ctx, agent, draft.id);
    await ctx.http().post(`${BASE}/${draft.id}/submit`).set(agent.auth).expect(200);
    const url = `/api/v1/admin/properties/${draft.id}/moderation`;

    for (const roles of [['support_admin'], ['content_manager'], ['finance_admin'], []]) {
      const { tokens } = await loginToken(ctx, await createAdmin(ctx, roles));
      await ctx
        .http()
        .patch(url)
        .set(bearer(tokens.accessToken))
        .send({ action: 'APPROVE' })
        .expect(403);
    }
    const customer = await loginToken(ctx, await registerCustomer(ctx));
    await ctx
      .http()
      .patch(url)
      .set(bearer(customer.tokens.accessToken))
      .send({ action: 'APPROVE' })
      .expect(403);
    await ctx
      .http()
      .get('/api/v1/admin/properties')
      .set(bearer(customer.tokens.accessToken))
      .expect(403);
    await ctx.http().get('/api/v1/admin/properties').set(agent.auth).expect(403);

    // Operations managers can approve (properties.view + properties.approve).
    const ops = await loginToken(ctx, await createAdmin(ctx, ['operations_manager']));
    await ctx
      .http()
      .patch(url)
      .set(bearer(ops.tokens.accessToken))
      .send({ action: 'APPROVE' })
      .expect(200);
  });

  it('lists the moderation queue oldest first', async () => {
    const moderator = await moderatorAuth(ctx);
    const ids: string[] = [];
    for (const title of ['First submitted', 'Second submitted']) {
      const agent = await createAgent(ctx);
      const draft = await createDraft(ctx, agent, { title });
      await uploadImage(ctx, agent, draft.id);
      await ctx.http().post(`${BASE}/${draft.id}/submit`).set(agent.auth).expect(200);
      ids.push(draft.id);
    }
    const res = await ctx
      .http()
      .get('/api/v1/admin/properties?status=PENDING_REVIEW')
      .set(moderator)
      .expect(200);
    expect(res.body.data.items.map((i: { id: string }) => i.id)).toEqual(ids);
  });
});

describe('plan limits', () => {
  it('[11] the free plan allows exactly one active property', async () => {
    const agent = await createAgent(ctx);
    await createDraft(ctx, agent);
    const second = await ctx.http().post(BASE).set(agent.auth).send(completeProperty()).expect(403);
    expect(second.body.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('[11] concurrent requests cannot exceed the limit', async () => {
    const agent = await createAgent(ctx);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        ctx.http().post(BASE).set(agent.auth).send(completeProperty()),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 403)).toHaveLength(4);
    expect(
      await ctx.prisma.property.count({ where: { agentProfileId: agent.agentProfileId } }),
    ).toBe(1);
  });

  it('[11] archiving frees the slot, but restoring respects the limit', async () => {
    const agent = await createAgent(ctx);
    const first = await createDraft(ctx, agent);
    await ctx.http().post(`${BASE}/${first.id}/archive`).set(agent.auth).expect(200);
    await createDraft(ctx, agent);
    const restore = await ctx
      .http()
      .post(`${BASE}/${first.id}/restore`)
      .set(agent.auth)
      .expect(403);
    expect(restore.body.code).toBe('PLAN_LIMIT_REACHED');
  });
});

describe('public visibility', () => {
  it('[8][9] only published listings are public', async () => {
    const statuses: Record<string, string> = {};
    const published = await createPublished(ctx, await createAgent(ctx), {
      title: 'Published home',
    });
    statuses[published.slug] = 'PUBLISHED';

    const draft = await createDraft(ctx, await createAgent(ctx), { title: 'Draft home' });
    statuses[draft.slug] = 'DRAFT';

    const pendingAgent = await createAgent(ctx);
    const pending = await createDraft(ctx, pendingAgent, { title: 'Pending home' });
    await uploadImage(ctx, pendingAgent, pending.id);
    await ctx.http().post(`${BASE}/${pending.id}/submit`).set(pendingAgent.auth).expect(200);

    const rejected = await createPublished(ctx, await createAgent(ctx), {
      title: 'Will be suspended',
    });
    await ctx
      .http()
      .patch(`/api/v1/admin/properties/${rejected.id}/moderation`)
      .set(await moderatorAuth(ctx))
      .send({ action: 'SUSPEND', note: 'Fraud report' })
      .expect(200);

    const archivedAgent = await createAgent(ctx);
    const archived = await createPublished(ctx, archivedAgent, { title: 'Archived home' });
    await ctx.http().post(`${BASE}/${archived.id}/archive`).set(archivedAgent.auth).expect(200);

    const search = await ctx.http().get('/api/v1/properties').expect(200);
    expect(search.body.data.items.map((i: { slug: string }) => i.slug)).toEqual([published.slug]);
    for (const slug of [draft.slug, pending.slug, rejected.slug, archived.slug]) {
      await ctx.http().get(`/api/v1/properties/${slug}`).expect(404);
    }
    await ctx.http().get(`/api/v1/properties/${published.slug}`).expect(200);
  });

  it('[13] public responses carry no private agent or moderation data', async () => {
    const agent = await createAgent(ctx);
    const property = await createPublished(ctx, agent);
    const detail = await ctx.http().get(`/api/v1/properties/${property.slug}`).expect(200);
    const search = await ctx.http().get('/api/v1/properties').expect(200);
    for (const body of [detail.body, search.body]) {
      const json = JSON.stringify(body);
      for (const secret of [
        agent.email,
        '+2348031234567',
        '1 Private Street',
        'moderationNote',
        'reviewer',
        'storageKey',
        'userId',
        'PENDING',
      ]) {
        expect(json).not.toContain(secret);
      }
    }
    expect(detail.body.data.agent).toEqual({
      id: agent.agentProfileId,
      displayName: expect.any(String),
      avatarUrl: null,
      verified: true,
      memberSince: expect.any(String),
      publishedPropertyCount: 1,
    });
  });
});
