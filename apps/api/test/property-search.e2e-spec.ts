import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bearer,
  createAgent,
  createPublished,
  createTestContext,
  loginToken,
  registerCustomer,
  type TestContext,
} from './helpers/test-app';

let ctx: TestContext;
const slugs: Record<string, string> = {};

/** Four live listings with distinct attributes, created once for this file. */
beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.reset();
  const wifi = await ctx.prisma.amenity.findUniqueOrThrow({ where: { slug: 'wi-fi' } });
  const pool = await ctx.prisma.amenity.findUniqueOrThrow({ where: { slug: 'swimming-pool' } });

  const listings = {
    lekkiShortlet: {
      title: 'Lekki shortlet with pool',
      pricingPeriod: 'DAILY',
      maxGuests: 4,
      priceKobo: 8_000_000,
      bedrooms: 2,
      bathrooms: 2,
      furnished: true,
      cleaningOption: 'INCLUDED',
      amenityIds: [wifi.id, pool.id],
    },
    ikejaYearly: {
      title: 'Ikeja family flat',
      city: 'Ikeja',
      lga: 'Ikeja',
      latitude: 6.6018,
      longitude: 3.3515,
      pricingPeriod: 'YEARLY',
      priceKobo: 300_000_000,
      bedrooms: 3,
      bathrooms: 2,
      amenityIds: [wifi.id],
    },
    abujaSale: {
      title: 'Maitama duplex for sale',
      propertyType: 'DUPLEX',
      listingType: 'SALE',
      pricingPeriod: 'SALE',
      city: 'Maitama',
      lga: 'Abuja Municipal',
      state: 'FCT',
      latitude: 9.0866,
      longitude: 7.4936,
      priceKobo: 45_000_000_000,
      bedrooms: 5,
      bathrooms: 6,
      cleaningOption: null,
    },
    lagosLand: {
      title: 'Epe land for sale',
      propertyType: 'LAND',
      listingType: 'SALE',
      pricingPeriod: 'SALE',
      city: 'Epe',
      lga: 'Epe',
      latitude: 6.5841,
      longitude: 3.9837,
      priceKobo: 1_500_000_000,
      bedrooms: null,
      bathrooms: null,
      cleaningOption: null,
      sizeSqm: 600,
    },
  };
  for (const [key, overrides] of Object.entries(listings)) {
    slugs[key] = (await createPublished(ctx, await createAgent(ctx), overrides)).slug;
  }
});
afterAll(() => ctx.close());

async function search(query: string): Promise<string[]> {
  const res = await ctx.http().get(`/api/v1/properties?${query}`).expect(200);
  return (res.body.data.items as { slug: string }[]).map((i) => i.slug);
}
const keys = (found: string[]) =>
  Object.entries(slugs)
    .filter(([, slug]) => found.includes(slug))
    .map(([key]) => key)
    .sort();

describe('property search', () => {
  it('returns every public listing, newest first, in a stable shape', async () => {
    const res = await ctx.http().get('/api/v1/properties').expect(200);
    expect(res.body.data).toMatchObject({
      page: 1,
      pageSize: 18,
      total: 4,
      totalPages: 1,
      favoriteIds: [],
    });
    expect(res.body.data.items[0].slug).toBe(slugs.lagosLand);
    expect(Object.keys(res.body.data.items[0]).sort()).toEqual(
      [
        'agent',
        'bathrooms',
        'bedrooms',
        'city',
        'coverImage',
        'discountPercent',
        'featured',
        'id',
        'latitude',
        'listingType',
        'longitude',
        'maxGuests',
        'pricingPeriod',
        'priceKobo',
        'propertyType',
        'publishedAt',
        'sizeSqm',
        'slug',
        'state',
        'title',
      ].sort(),
    );
  });

  it.each([
    ['q=maitama', ['abujaSale']],
    ['q=LEKKI', ['lekkiShortlet']],
    ['state=fct', ['abujaSale']],
    ['city=Ikeja', ['ikejaYearly']],
    ['listingType=SALE', ['abujaSale', 'lagosLand']],
    ['listingType=RENT&pricingPeriod=DAILY', ['lekkiShortlet']],
    ['pricingPeriod=DAILY,YEARLY', ['ikejaYearly', 'lekkiShortlet']],
    ['propertyType=LAND', ['lagosLand']],
    ['propertyType=DUPLEX,LAND', ['abujaSale', 'lagosLand']],
    ['minPrice=100000000&maxPrice=2000000000', ['ikejaYearly', 'lagosLand']],
    ['minBedrooms=3', ['abujaSale', 'ikejaYearly']],
    ['minBathrooms=6', ['abujaSale']],
    ['minGuests=3', ['lekkiShortlet']],
    ['furnished=true', ['lekkiShortlet']],
    ['cleaningIncluded=true', ['lekkiShortlet']],
    ['amenities=wi-fi', ['ikejaYearly', 'lekkiShortlet']],
    ['amenities=wi-fi,swimming-pool', ['lekkiShortlet']],
    ['bbox=2.7,6.0,4.5,7.0', ['ikejaYearly', 'lagosLand', 'lekkiShortlet']],
    ['bbox=7.0,8.5,8.0,9.5', ['abujaSale']],
  ])('%s', async (query, expected) => {
    expect(keys(await search(query))).toEqual(expected);
  });

  it('sorts by price', async () => {
    expect(await search('sort=price_asc')).toEqual([
      slugs.lekkiShortlet,
      slugs.ikejaYearly,
      slugs.lagosLand,
      slugs.abujaSale,
    ]);
    expect(await search('sort=price_desc')).toEqual([
      slugs.abujaSale,
      slugs.lagosLand,
      slugs.ikejaYearly,
      slugs.lekkiShortlet,
    ]);
  });

  it('paginates', async () => {
    const res = await ctx.http().get('/api/v1/properties?pageSize=3&page=2').expect(200);
    expect(res.body.data).toMatchObject({ page: 2, pageSize: 3, total: 4, totalPages: 2 });
    expect(res.body.data.items).toHaveLength(1);
  });

  it('validates filters', async () => {
    for (const query of [
      'pageSize=500',
      'propertyType=CASTLE',
      'sort=random',
      'bbox=1,2,3',
      'minPrice=-5',
    ]) {
      const res = await ctx.http().get(`/api/v1/properties?${query}`).expect(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns detail, similar listings and SEO-safe fields', async () => {
    const detail = await ctx.http().get(`/api/v1/properties/${slugs.lekkiShortlet}`).expect(200);
    expect(detail.body.data).toMatchObject({
      title: 'Lekki shortlet with pool',
      pricingPeriod: 'DAILY',
      cleaningOption: 'INCLUDED',
      isFavorite: false,
    });
    expect(detail.body.data.amenities.map((a: { slug: string }) => a.slug).sort()).toEqual([
      'swimming-pool',
      'wi-fi',
    ]);
    expect(detail.body.data.images).toHaveLength(1);

    const similar = await ctx
      .http()
      .get(`/api/v1/properties/${slugs.abujaSale}/similar`)
      .expect(200);
    expect(similar.body.data.map((p: { slug: string }) => p.slug)).toEqual([]);
    const similarRent = await ctx
      .http()
      .get(`/api/v1/properties/${slugs.ikejaYearly}/similar`)
      .expect(200);
    expect(similarRent.body.data.map((p: { slug: string }) => p.slug)).toEqual([
      slugs.lekkiShortlet,
    ]);

    await ctx.http().get('/api/v1/properties/does-not-exist').expect(404);
    await ctx.http().get('/api/v1/properties/..%2Fadmin').expect(404);
  });

  it('filters by agent for public profiles', async () => {
    const detail = await ctx.http().get(`/api/v1/properties/${slugs.abujaSale}`).expect(200);
    expect(await search(`agent=${detail.body.data.agent.id}`)).toEqual([slugs.abujaSale]);
  });

  it('counts a view at most once per visitor', async () => {
    const detail = await ctx.http().get(`/api/v1/properties/${slugs.ikejaYearly}`).expect(200);
    const id = detail.body.data.id as string;
    for (let i = 0; i < 3; i++) {
      await ctx
        .http()
        .post(`/api/v1/properties/${id}/views`)
        .set('User-Agent', 'qa-browser')
        .expect(202);
    }
    await ctx
      .http()
      .post(`/api/v1/properties/${id}/views`)
      .set('User-Agent', 'another-browser')
      .expect(202);
    const total = await ctx.prisma.propertyViewDaily.aggregate({
      where: { propertyId: id },
      _sum: { views: true },
    });
    expect(total._sum.views).toBe(2);
  });

  it('marks favourites for signed-in customers', async () => {
    const { tokens } = await loginToken(ctx, await registerCustomer(ctx));
    const detail = await ctx.http().get(`/api/v1/properties/${slugs.lagosLand}`).expect(200);
    await ctx
      .http()
      .put(`/api/v1/favorites/${detail.body.data.id}`)
      .set(bearer(tokens.accessToken))
      .expect(200);
    const res = await ctx
      .http()
      .get('/api/v1/properties')
      .set(bearer(tokens.accessToken))
      .expect(200);
    expect(res.body.data.favoriteIds).toEqual([detail.body.data.id]);
    const again = await ctx
      .http()
      .get(`/api/v1/properties/${slugs.lagosLand}`)
      .set(bearer(tokens.accessToken))
      .expect(200);
    expect(again.body.data.isFavorite).toBe(true);
  });
});
