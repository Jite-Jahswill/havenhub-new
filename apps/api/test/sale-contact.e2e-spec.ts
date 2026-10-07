import type { AgentPropertyView, PropertyDetail, SaleContactView } from '@havenhub/shared';
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

const NOTICE =
  'Deals arranged directly with an agent happen outside HavenHub. HavenHub is not a party to them.';
const SALE = { listingType: 'SALE', pricingPeriod: 'SALE', priceKobo: 9_000_000_000 };

async function setSales(sales: Record<string, unknown>) {
  const admin = (await adminAuth(ctx, ['super_admin'])).auth;
  await ctx.http().patch('/api/v1/admin/settings/policies').set(admin).send({ sales }).expect(200);
}

const detail = async (slug: string) =>
  (await ctx.http().get(`/api/v1/properties/${slug}`).expect(200)).body.data as PropertyDetail;

describe('sale mode', () => {
  it('sale listings are contact for sale; buying on HavenHub is not open yet; rentals have none', async () => {
    const agent = await createAgent(ctx);
    const created = await ctx
      .http()
      .post('/api/v1/agents/me/properties')
      .set(agent.auth)
      .send({ title: 'Four-bedroom duplex in Lekki', propertyType: 'HOUSE', listingType: 'SALE' })
      .expect(201);
    expect((created.body.data as AgentPropertyView).saleMode).toBe('CONTACT');
    const id = (created.body.data as AgentPropertyView).id;

    const inApp = await ctx
      .http()
      .patch(`/api/v1/agents/me/properties/${id}`)
      .set(agent.auth)
      .send({ saleMode: 'IN_APP' })
      .expect(403);
    expect(inApp.body.code).toBe('FEATURE_DISABLED');

    // Switching to rent clears it; back to sale restores the default.
    const rent = await ctx
      .http()
      .patch(`/api/v1/agents/me/properties/${id}`)
      .set(agent.auth)
      .send({ listingType: 'RENT', pricingPeriod: 'YEARLY' })
      .expect(200);
    expect(rent.body.data.saleMode).toBeNull();
    const sale = await ctx
      .http()
      .patch(`/api/v1/agents/me/properties/${id}`)
      .set(agent.auth)
      .send({ listingType: 'SALE' })
      .expect(200);
    expect(sale.body.data.saleMode).toBe('CONTACT');
  });
});

describe('contact for sale', () => {
  it('needs the notice set by admins before contact details are shown', async () => {
    const agent = await createAgent(ctx);
    const listing = await createPublished(ctx, agent, SALE);
    expect((await detail(listing.slug)).saleContact).toBeNull();
    const c = await customer(ctx);
    await ctx
      .http()
      .post(`/api/v1/properties/${listing.slug}/sale-contact`)
      .set(c.auth)
      .send({ accepted: true, disclaimerHash: 'a'.repeat(64) })
      .expect(403);

    await setSales({ disclaimer: NOTICE });
    expect((await detail(listing.slug)).saleContact).toMatchObject({ disclaimer: NOTICE });
  });

  it('records the exact notice the buyer accepted, then shows the agent’s contact details', async () => {
    await setSales({ disclaimer: NOTICE });
    const agent = await createAgent(ctx);
    const listing = await createPublished(ctx, agent, SALE);
    const { disclaimerHash } = (await detail(listing.slug)).saleContact!;
    const c = await customer(ctx);
    const url = `/api/v1/properties/${listing.slug}/sale-contact`;

    // Signed in, verified buyers only; acceptance must be explicit.
    await ctx.http().post(url).send({ accepted: true, disclaimerHash }).expect(401);
    await ctx.http().post(url).set(c.auth).send({ accepted: false, disclaimerHash }).expect(422);

    const res = await ctx
      .http()
      .post(url)
      .set(c.auth)
      .set('User-Agent', 'BuyerBrowser/1.0')
      .send({ accepted: true, disclaimerHash })
      .expect(200);
    expect(res.body.data as SaleContactView).toMatchObject({
      email: agent.email,
      phone: '+2348031234567',
    });

    const evidence = await ctx.prisma.saleContactAcceptance.findFirstOrThrow();
    expect(evidence).toMatchObject({
      userId: c.id,
      propertyId: listing.id,
      disclaimerText: NOTICE,
      disclaimerHash,
      userAgent: 'BuyerBrowser/1.0',
    });
    // Append-only: evidence cannot be changed or removed.
    await expect(
      ctx.prisma.saleContactAcceptance.update({
        where: { id: evidence.id },
        data: { disclaimerText: 'edited' },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      ctx.prisma.saleContactAcceptance.delete({ where: { id: evidence.id } }),
    ).rejects.toThrow(/append-only/);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'property.sale_contact.accepted' } }),
    ).toBe(1);
  });

  it('must be accepted again when the notice changes', async () => {
    await setSales({ disclaimer: NOTICE });
    const listing = await createPublished(ctx, await createAgent(ctx), SALE);
    const { disclaimerHash } = (await detail(listing.slug)).saleContact!;
    await setSales({ disclaimer: `${NOTICE} Updated.` });
    const c = await customer(ctx);
    await ctx
      .http()
      .post(`/api/v1/properties/${listing.slug}/sale-contact`)
      .set(c.auth)
      .send({ accepted: true, disclaimerHash })
      .expect(409);
  });

  it('can be switched off by admins, and is never offered for rentals', async () => {
    await setSales({ disclaimer: NOTICE, contactEnabled: false });
    const sale = await createPublished(ctx, await createAgent(ctx), SALE);
    expect((await detail(sale.slug)).saleContact).toBeNull();
    await setSales({ contactEnabled: true });
    const rental = await createPublished(ctx, await createAgent(ctx));
    expect((await detail(rental.slug)).saleContact).toBeNull();
    const c = await customer(ctx);
    await ctx
      .http()
      .post(`/api/v1/properties/${rental.slug}/sale-contact`)
      .set(c.auth)
      .send({ accepted: true, disclaimerHash: 'a'.repeat(64) })
      .expect(404);
  });
});
