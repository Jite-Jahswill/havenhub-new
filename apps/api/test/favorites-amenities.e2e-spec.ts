import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  bearer,
  createAdmin,
  createAgent,
  createDraft,
  createPublished,
  createTestContext,
  loginToken,
  moderatorAuth,
  registerCustomer,
  type TestContext,
} from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

async function customer() {
  const { tokens, user } = await loginToken(ctx, await registerCustomer(ctx));
  return { id: user.id, auth: bearer(tokens.accessToken) };
}

describe('favorites', () => {
  it('favourite, list and unfavourite (idempotently)', async () => {
    const property = await createPublished(ctx, await createAgent(ctx));
    const me = await customer();
    await ctx.http().put(`/api/v1/favorites/${property.id}`).set(me.auth).expect(200);
    await ctx.http().put(`/api/v1/favorites/${property.id}`).set(me.auth).expect(200);
    const list = await ctx.http().get('/api/v1/favorites').set(me.auth).expect(200);
    expect(list.body.data.items.map((p: { id: string }) => p.id)).toEqual([property.id]);
    await ctx.http().delete(`/api/v1/favorites/${property.id}`).set(me.auth).expect(200);
    await ctx.http().delete(`/api/v1/favorites/${property.id}`).set(me.auth).expect(200);
    expect(
      (await ctx.http().get('/api/v1/favorites').set(me.auth).expect(200)).body.data.total,
    ).toBe(0);
  });

  it("[6] a customer cannot change another customer's favourites", async () => {
    const property = await createPublished(ctx, await createAgent(ctx));
    const alice = await customer();
    const bob = await customer();
    await ctx.http().put(`/api/v1/favorites/${property.id}`).set(alice.auth).expect(200);
    // Bob's delete only ever applies to Bob's own favourites.
    await ctx
      .http()
      .delete(`/api/v1/favorites/${property.id}`)
      .set(bob.auth)
      .send({ userId: alice.id })
      .expect(200);
    await ctx
      .http()
      .delete(`/api/v1/favorites/${property.id}?userId=${alice.id}`)
      .set(bob.auth)
      .expect(200);
    expect(await ctx.prisma.propertyFavorite.count({ where: { userId: alice.id } })).toBe(1);
    expect(
      (await ctx.http().get('/api/v1/favorites').set(bob.auth).expect(200)).body.data.total,
    ).toBe(0);
  });

  it('cannot favourite non-public listings, and hidden ones drop out of the list', async () => {
    const agent = await createAgent(ctx);
    const me = await customer();
    const draft = await createDraft(ctx, agent);
    await ctx.http().put(`/api/v1/favorites/${draft.id}`).set(me.auth).expect(404);

    const other = await createPublished(ctx, await createAgent(ctx));
    await ctx.http().put(`/api/v1/favorites/${other.id}`).set(me.auth).expect(200);
    await ctx
      .http()
      .patch(`/api/v1/admin/properties/${other.id}/moderation`)
      .set(await moderatorAuth(ctx))
      .send({ action: 'SUSPEND', note: 'Under investigation' })
      .expect(200);
    expect(
      (await ctx.http().get('/api/v1/favorites').set(me.auth).expect(200)).body.data.total,
    ).toBe(0);
  });

  it('is for customers only, and requires sign-in', async () => {
    const property = await createPublished(ctx, await createAgent(ctx));
    const agent = await createAgent(ctx);
    await ctx.http().put(`/api/v1/favorites/${property.id}`).set(agent.auth).expect(403);
    await ctx.http().put(`/api/v1/favorites/${property.id}`).expect(401);
    await ctx.http().get('/api/v1/favorites').expect(401);
  });
});

describe('amenities', () => {
  it('lists active amenities publicly', async () => {
    const res = await ctx.http().get('/api/v1/amenities').expect(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(20);
    expect(res.body.data[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        slug: expect.any(String),
        category: 'ESSENTIALS',
      }),
    );
  });

  it('admins with amenities.manage can create, edit and deactivate', async () => {
    const { tokens } = await loginToken(ctx, await createAdmin(ctx, ['property_manager']));
    const auth = bearer(tokens.accessToken);
    const name = `Solar power ${Date.now()}`;
    const created = await ctx
      .http()
      .post('/api/v1/admin/amenities')
      .set(auth)
      .send({ name, category: 'ESSENTIALS', icon: 'sun' })
      .expect(201);
    expect(created.body.data).toMatchObject({ name, isActive: true, propertyCount: 0 });
    await ctx
      .http()
      .post('/api/v1/admin/amenities')
      .set(auth)
      .send({ name, category: 'ESSENTIALS' })
      .expect(409);

    const id = created.body.data.id as string;
    await ctx
      .http()
      .patch(`/api/v1/admin/amenities/${id}`)
      .set(auth)
      .send({ isActive: false })
      .expect(200);
    const publicList = await ctx.http().get('/api/v1/amenities').expect(200);
    expect(publicList.body.data.map((a: { id: string }) => a.id)).not.toContain(id);
    expect(await ctx.prisma.auditLog.count({ where: { resourceId: id } })).toBe(2);

    // Agents cannot attach inactive amenities.
    const agent = await createAgent(ctx);
    const res = await ctx
      .http()
      .post('/api/v1/agents/me/properties')
      .set(agent.auth)
      .send({ title: 'Solar house', propertyType: 'HOUSE', listingType: 'RENT', amenityIds: [id] })
      .expect(422);
    expect(res.body.details.issues[0].path).toBe('amenityIds');
    await ctx.prisma.amenity.delete({ where: { id } });
  });

  it('agents and admins without the permission cannot manage amenities', async () => {
    const agent = await createAgent(ctx);
    const support = await loginToken(ctx, await createAdmin(ctx, ['support_admin']));
    for (const auth of [agent.auth, bearer(support.tokens.accessToken)]) {
      await ctx.http().get('/api/v1/admin/amenities').set(auth).expect(403);
      await ctx
        .http()
        .post('/api/v1/admin/amenities')
        .set(auth)
        .send({ name: 'Hack', category: 'SAFETY' })
        .expect(403);
    }
  });
});
