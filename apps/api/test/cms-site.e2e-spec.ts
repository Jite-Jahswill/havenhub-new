import type { AdminHomepageSection } from '@havenhub/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminAuth } from './helpers/booking-helpers';
import {
  createAgent,
  createPublished,
  createTestContext,
  testImage,
  type TestContext,
} from './helpers/test-app';

let ctx: TestContext;
const CMS = '/api/v1/admin/cms';

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const content = async () => (await adminAuth(ctx, ['content_manager'])).auth;

async function uploadMedia(auth: Record<string, string>) {
  const res = await ctx
    .http()
    .post(`${CMS}/media`)
    .set(auth)
    .attach('file', await testImage(400, 300), { filename: 'a.jpg', contentType: 'image/jpeg' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; url: string; thumbnailUrl: string };
}

describe('site settings', () => {
  it('defaults exist; updates are permissioned, validated, audited and public at once', async () => {
    const site = (await ctx.http().get('/api/v1/site').expect(200)).body.data;
    expect(site).toMatchObject({
      siteName: 'HavenHub',
      features: { blog: true, careers: false, helpCenter: false, newsletter: false },
      pages: [],
      mediaBase: '/api/media',
    });

    for (const role of ['finance_admin', 'support_admin', 'seo_manager']) {
      const a = await adminAuth(ctx, [role]);
      await ctx.http().patch(`${CMS}/site`).set(a.auth).send({ siteName: 'Hacked' }).expect(403);
    }
    const agent = await createAgent(ctx);
    await ctx.http().get(`${CMS}/site`).set(agent.auth).expect(403);

    const auth = await content();
    for (const bad of [
      { socialLinks: [{ network: 'X', url: 'javascript:alert(1)' }] },
      { socialLinks: [{ network: 'X', url: 'http://insecure.example' }] },
      { contactEmail: 'not-an-email' },
      { cvRetentionDays: 0 },
      { newsletterRetentionDays: 0 },
      { unknownField: true },
    ]) {
      await ctx.http().patch(`${CMS}/site`).set(auth).send(bad).expect(422);
    }
    await ctx
      .http()
      .patch(`${CMS}/site`)
      .set(auth)
      .send({
        siteName: 'HavenHub NG',
        contactEmail: 'Hello@HavenHub.ng',
        socialLinks: [{ network: 'INSTAGRAM', url: 'https://instagram.com/havenhub' }],
        footerText: 'Line one\u0007\nLine two',
        helpCenterEnabled: true,
      })
      .expect(200);
    const after = (await ctx.http().get('/api/v1/site').expect(200)).body.data;
    expect(after).toMatchObject({
      siteName: 'HavenHub NG',
      contact: { email: 'hello@havenhub.ng' },
      footerText: 'Line one\nLine two',
      features: { helpCenter: true },
    });
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'cms.site_settings.updated' } }),
    ).toBe(1);
  });

  it('logo and favicon are re-encoded images; replacing removes the old file', async () => {
    const auth = await content();
    const logo = await ctx
      .http()
      .post(`${CMS}/site/logo`)
      .set(auth)
      .attach('file', await testImage(600, 200), { filename: 'l.png', contentType: 'image/png' })
      .expect(201);
    expect(logo.body.data.logo.url).toMatch(/^\/api\/media\/cms\/site\/[0-9a-f-]+-logo\.webp$/);
    const fav = await ctx
      .http()
      .post(`${CMS}/site/favicon`)
      .set(auth)
      .attach('file', await testImage(256, 256), { filename: 'f.png', contentType: 'image/png' })
      .expect(201);
    expect(fav.body.data.faviconUrl).toMatch(/-favicon\.png$/);
    await ctx.http().get(fav.body.data.faviconUrl).expect(200).expect('content-type', 'image/png');
    await ctx
      .http()
      .post(`${CMS}/site/logo`)
      .set(auth)
      .attach('file', Buffer.from('<svg onload="alert(1)"/>'), {
        filename: 'x.svg',
        contentType: 'image/svg+xml',
      })
      .expect(422);
    await ctx.http().delete(`${CMS}/site/logo`).set(auth).expect(200);
    await ctx.http().get(logo.body.data.logo.url).expect(404);
    await ctx.http().post(`${CMS}/site/banner`).set(auth).expect(422);
  });
});

describe('legal and static pages', () => {
  it('terms and privacy exist as empty drafts and are not public until published', async () => {
    const auth = await content();
    const pages = (await ctx.http().get(`${CMS}/pages`).set(auth).expect(200)).body.data.items;
    expect(pages.map((p: { slug: string }) => p.slug).sort()).toEqual([
      'about',
      'contact',
      'privacy',
      'terms',
    ]);
    for (const p of pages) expect(p).toMatchObject({ status: 'DRAFT', system: true });
    await ctx.http().get('/api/v1/pages/terms').expect(404);
    const terms = pages.find((p: { slug: string }) => p.slug === 'terms');
    // No invented legal text: publishing an empty page is refused.
    await ctx
      .http()
      .post(`${CMS}/pages/${terms.id}/status`)
      .set(auth)
      .send({ status: 'PUBLISHED' })
      .expect(422);
    await ctx.http().patch(`${CMS}/pages/${terms.id}`).set(auth).send({ slug: 'tos' }).expect(422);
    await ctx.http().delete(`${CMS}/pages/${terms.id}`).set(auth).expect(409);

    await ctx
      .http()
      .patch(`${CMS}/pages/${terms.id}`)
      .set(auth)
      .send({ body: 'Text supplied by the business.' })
      .expect(200);
    await ctx
      .http()
      .post(`${CMS}/pages/${terms.id}/status`)
      .set(auth)
      .send({ status: 'PUBLISHED' })
      .expect(200);
    const pub = (await ctx.http().get('/api/v1/pages/terms').expect(200)).body.data;
    expect(pub).toMatchObject({ slug: 'terms', body: 'Text supplied by the business.' });
    const site = (await ctx.http().get('/api/v1/site').expect(200)).body.data;
    expect(site.pages).toEqual([{ slug: 'terms', title: 'Terms of service' }]);
  });

  it('custom pages: unique slugs, draft-only deletion, archive first', async () => {
    const auth = await content();
    const page = (
      await ctx
        .http()
        .post(`${CMS}/pages`)
        .set(auth)
        .send({ title: 'Our story', body: 'Hello' })
        .expect(201)
    ).body.data;
    expect(page.slug).toBe('our-story');
    await ctx
      .http()
      .post(`${CMS}/pages`)
      .set(auth)
      .send({ title: 'Other', slug: 'our-story' })
      .expect(409);
    const second = (
      await ctx.http().post(`${CMS}/pages`).set(auth).send({ title: 'Our story' }).expect(201)
    ).body.data;
    expect(second.slug).toMatch(/^our-story-[0-9a-f]{6}$/);
    await ctx
      .http()
      .post(`${CMS}/pages/${page.id}/status`)
      .set(auth)
      .send({ status: 'PUBLISHED' })
      .expect(200);
    await ctx.http().delete(`${CMS}/pages/${page.id}`).set(auth).expect(409);
    await ctx
      .http()
      .post(`${CMS}/pages/${page.id}/status`)
      .set(auth)
      .send({ status: 'ARCHIVED' })
      .expect(200);
    await ctx.http().get('/api/v1/pages/our-story').expect(404);
    await ctx.http().delete(`${CMS}/pages/${page.id}`).set(auth).expect(200);
    await ctx.http().delete(`${CMS}/pages/${second.id}`).set(auth).expect(200);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'cms.page.deleted' } })).toBe(2);
    await ctx.http().get('/api/v1/pages/..%2Fadmin').expect(404);
  });

  it('Markdown images must be CMS media; other image URLs are refused', async () => {
    const auth = await content();
    const media = await uploadMedia(auth);
    for (const body of [
      '![x](https://evil.example/track.png)',
      '![x](/api/media/properties/abc/x-lg.webp)',
      '![x](/api/media/cms/media/00000000-0000-0000-0000-000000000000-lg.webp)',
    ]) {
      await ctx.http().post(`${CMS}/pages`).set(auth).send({ title: 'Images', body }).expect(422);
    }
    await ctx
      .http()
      .post(`${CMS}/pages`)
      .set(auth)
      .send({
        title: 'Images',
        body: `![ok](${media.url})\n\n[link](javascript:alert(1)) <script>x</script>`,
      })
      .expect(201);
  });
});

describe('homepage builder', () => {
  it('ships with the original hero and explore sections only', async () => {
    const home = (await ctx.http().get('/api/v1/homepage').expect(200)).body.data;
    expect(home.map((s: { key: string }) => s.key)).toEqual(['HERO', 'EXPLORE']);
    expect(home[0]).toMatchObject({
      title: 'Find your next place to live, stay, work, or explore.',
      showSearch: true,
    });
  });

  it('validates settings per section and never enables unavailable sections', async () => {
    const auth = await content();
    await ctx
      .http()
      .patch(`${CMS}/homepage/SPECIAL_OFFERS`)
      .set(auth)
      .send({ enabled: true })
      .expect(422);
    await ctx.http().patch(`${CMS}/homepage/AWARDS`).set(auth).send({ enabled: true }).expect(422);
    await ctx
      .http()
      .patch(`${CMS}/homepage/HERO`)
      .set(auth)
      .send({
        config: { showSearch: true, links: [{ label: 'Bad', href: 'javascript:alert(1)' }] },
      })
      .expect(422);
    await ctx
      .http()
      .patch(`${CMS}/homepage/FEATURED_PROPERTIES`)
      .set(auth)
      .send({ config: { limit: 500 } })
      .expect(422);
    await ctx.http().patch(`${CMS}/homepage/NOPE`).set(auth).send({ enabled: true }).expect(422);
    const sections: AdminHomepageSection[] = (
      await ctx.http().get(`${CMS}/homepage`).set(auth).expect(200)
    ).body.data;
    expect(sections.find((s) => s.key === 'SPECIAL_OFFERS')).toMatchObject({
      available: false,
      enabled: false,
    });
  });

  it('listing sections appear only with public data; toggles and order apply immediately', async () => {
    const auth = await content();
    for (const key of ['FEATURED_PROPERTIES', 'RENT_PROPERTIES', 'TESTIMONIALS', 'CTA']) {
      await ctx
        .http()
        .patch(`${CMS}/homepage/${key}`)
        .set(auth)
        .send({ enabled: true })
        .expect(200);
    }
    // Nothing public yet → hidden; CTA needs a title.
    let home = (await ctx.http().get('/api/v1/homepage').expect(200)).body.data;
    expect(home.map((s: { key: string }) => s.key)).toEqual(['HERO', 'EXPLORE']);

    const agent = await createAgent(ctx);
    await createPublished(ctx, agent);
    await ctx
      .http()
      .post(`${CMS}/testimonials`)
      .set(auth)
      .send({ quote: 'Found my flat in a week.', authorName: 'Ada', published: true })
      .expect(201);
    await ctx
      .http()
      .patch(`${CMS}/homepage/CTA`)
      .set(auth)
      .send({
        title: 'List your property',
        config: { button: { label: 'Get started', href: '/register/agent' } },
      })
      .expect(200);
    home = (await ctx.http().get('/api/v1/homepage').expect(200)).body.data;
    expect(home.map((s: { key: string }) => s.key)).toEqual([
      'HERO',
      'EXPLORE',
      'RENT_PROPERTIES',
      'TESTIMONIALS',
      'CTA',
    ]);
    expect(home[2].properties).toHaveLength(1);

    const sections: AdminHomepageSection[] = (
      await ctx.http().get(`${CMS}/homepage`).set(auth).expect(200)
    ).body.data;
    const keys = sections.map((s) => s.key).reverse();
    await ctx.http().put(`${CMS}/homepage/order`).set(auth).send({ keys }).expect(200);
    await ctx
      .http()
      .put(`${CMS}/homepage/order`)
      .set(auth)
      .send({ keys: keys.slice(1) })
      .expect(422);
    await ctx.http().patch(`${CMS}/homepage/HERO`).set(auth).send({ enabled: false }).expect(200);
    home = (await ctx.http().get('/api/v1/homepage').expect(200)).body.data;
    expect(home.map((s: { key: string }) => s.key)).toEqual([
      'CTA',
      'TESTIMONIALS',
      'RENT_PROPERTIES',
      'EXPLORE',
    ]);
  });
});

describe('media library', () => {
  it('images in use cannot be deleted; unused ones can (files removed)', async () => {
    const auth = await content();
    const media = await uploadMedia(auth);
    await ctx.http().get(media.url).expect(200);
    await ctx
      .http()
      .post(`${CMS}/testimonials`)
      .set(auth)
      .send({ quote: 'A lovely experience overall.', authorName: 'Bayo', photoId: media.id })
      .expect(201);
    const blocked = await ctx.http().delete(`${CMS}/media/${media.id}`).set(auth).expect(409);
    expect(blocked.body.message).toMatch(/testimonials/);
    const page = await ctx
      .http()
      .post(`${CMS}/pages`)
      .set(auth)
      .send({ title: 'Gallery', body: `![a](${media.url})` })
      .expect(201);
    await ctx.prisma.testimonial.deleteMany();
    expect(
      (await ctx.http().delete(`${CMS}/media/${media.id}`).set(auth).expect(409)).body.message,
    ).toMatch(/pages/);
    await ctx.prisma.page.delete({ where: { id: page.body.data.id } });
    await ctx.http().delete(`${CMS}/media/${media.id}`).set(auth).expect(200);
    await ctx.http().get(media.url).expect(404);
  });

  it('only content editors can upload; any CMS editor can browse', async () => {
    const seo = (await adminAuth(ctx, ['seo_manager'])).auth;
    await ctx.http().get(`${CMS}/media`).set(seo).expect(200);
    await ctx
      .http()
      .post(`${CMS}/media`)
      .set((await adminAuth(ctx, ['finance_admin'])).auth)
      .attach('file', await testImage(), { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(403);
    await ctx
      .http()
      .get(`${CMS}/media`)
      .set((await adminAuth(ctx, ['finance_admin'])).auth)
      .expect(403);
  });
});

describe('SEO, robots and sitemap', () => {
  it('only SEO managers edit SEO; robots always hides private areas; sitemap lists public content', async () => {
    const seo = (await adminAuth(ctx, ['seo_manager'])).auth;
    await ctx
      .http()
      .patch(`${CMS}/seo`)
      .set(await content())
      .send({ seoTitle: 'x' })
      .expect(403);
    await ctx
      .http()
      .patch(`${CMS}/seo`)
      .set(seo)
      .send({ seoTitle: 'HavenHub', robotsDisallow: ['/drafts'], twitterHandle: 'havenhub' })
      .expect(200);
    await ctx
      .http()
      .patch(`${CMS}/seo`)
      .set(seo)
      .send({ robotsDisallow: ['no-slash'] })
      .expect(422);
    await ctx
      .http()
      .put(`${CMS}/seo/routes`)
      .set(seo)
      .send({ path: '/blog', title: 'Blog', noIndex: true })
      .expect(200);
    await ctx
      .http()
      .put(`${CMS}/seo/routes`)
      .set(seo)
      .send({ path: '/admin', title: 'x' })
      .expect(422);

    const pub = (await ctx.http().get('/api/v1/seo').expect(200)).body.data;
    expect(pub.robots.disallow).toEqual(
      expect.arrayContaining(['/admin', '/agent', '/account', '/api', '/drafts']),
    );
    expect(pub.routes['/blog']).toMatchObject({ title: 'Blog', noIndex: true });

    const agent = await createAgent(ctx);
    const live = await createPublished(ctx, agent);
    const draft = await ctx.prisma.property.findFirstOrThrow({ where: { id: live.id } });
    const map = (await ctx.http().get('/api/v1/seo/sitemap').expect(200)).body.data as {
      path: string;
    }[];
    const paths = map.map((e) => e.path);
    expect(paths).toContain('/');
    expect(paths).toContain(`/properties/${draft.slug}`);
    expect(paths).not.toContain('/blog');
    expect(paths.some((p) => p.startsWith('/admin'))).toBe(false);

    await ctx.http().patch(`${CMS}/seo`).set(seo).send({ allowIndexing: false }).expect(200);
    expect((await ctx.http().get('/api/v1/seo/sitemap').expect(200)).body.data).toEqual([]);
  });
});
