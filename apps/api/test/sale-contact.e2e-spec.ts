import { DEFAULT_SALES_DISCLAIMER, type PropertyDetail } from '@havenhub/shared';
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

const detail = async (slug: string, auth?: Record<string, string>) => {
  const req = ctx.http().get(`/api/v1/properties/${slug}`);
  return (await (auth ? req.set(auth) : req).expect(200)).body.data as PropertyDetail;
};

describe('property sales (always off HavenHub)', () => {
  it('shows signed-in visitors the agent’s contact details with the standard notice', async () => {
    const agent = await createAgent(ctx);
    const listing = await createPublished(ctx, agent, SALE);
    expect(listing).not.toHaveProperty('saleMode');

    // Signed out: the notice, but no contact details.
    expect((await detail(listing.slug)).saleContact).toEqual({
      disclaimer: DEFAULT_SALES_DISCLAIMER,
      contact: null,
    });
    const c = await customer(ctx);
    expect((await detail(listing.slug, c.auth)).saleContact).toEqual({
      disclaimer: DEFAULT_SALES_DISCLAIMER,
      contact: { email: agent.email, phone: '+2348031234567' },
    });
    // Nothing to accept or record any more.
    await ctx
      .http()
      .post(`/api/v1/properties/${listing.slug}/sale-contact`)
      .set(c.auth)
      .send({})
      .expect(404);
    expect(await ctx.prisma.saleContactAcceptance.count()).toBe(0);
  });

  it('uses the administrators’ notice when set, and can be switched off', async () => {
    const listing = await createPublished(ctx, await createAgent(ctx), SALE);
    await setSales({ disclaimer: NOTICE });
    expect((await detail(listing.slug)).saleContact?.disclaimer).toBe(NOTICE);

    await setSales({ contactEnabled: false });
    const c = await customer(ctx);
    expect((await detail(listing.slug, c.auth)).saleContact).toBeNull();
  });

  it('is never shown for rentals', async () => {
    const rental = await createPublished(ctx, await createAgent(ctx));
    const c = await customer(ctx);
    expect((await detail(rental.slug, c.auth)).saleContact).toBeNull();
  });
});
