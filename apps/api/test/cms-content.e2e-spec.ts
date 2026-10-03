import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminAuth } from './helpers/booking-helpers';
import { createTestContext, type TestContext } from './helpers/test-app';

let ctx: TestContext;
const BLOG = '/api/v1/admin/blog';
const HELP = '/api/v1/admin/help';

beforeAll(async () => {
  ctx = await createTestContext();
});
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const BODY =
  'Lagos has many neighbourhoods.\n\n## Lekki\n\nGreat for families and short stays near the beach.';

async function post(auth: Record<string, string>, extra: Record<string, unknown> = {}) {
  const res = await ctx
    .http()
    .post(`${BLOG}/posts`)
    .set(auth)
    .send({ title: 'Where to live in Lagos', excerpt: 'A guide', body: BODY, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; slug: string; displayStatus: string };
}

describe('blog', () => {
  it('drafts are private; publishing, scheduling and unpublishing control visibility', async () => {
    const auth = (await adminAuth(ctx, ['content_manager'])).auth;
    const draft = await post(auth);
    expect(draft).toMatchObject({ slug: 'where-to-live-in-lagos', displayStatus: 'DRAFT' });
    await ctx.http().get(`/api/v1/blog/posts/${draft.slug}`).expect(404);

    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const scheduled = await ctx
      .http()
      .post(`${BLOG}/posts/${draft.id}/publish`)
      .set(auth)
      .send({ publishAt: future })
      .expect(200);
    expect(scheduled.body.data.displayStatus).toBe('SCHEDULED');
    await ctx.http().get(`/api/v1/blog/posts/${draft.slug}`).expect(404);
    expect((await ctx.http().get('/api/v1/blog/posts').expect(200)).body.data.total).toBe(0);

    await ctx.http().post(`${BLOG}/posts/${draft.id}/publish`).set(auth).send({}).expect(200);
    const pub = (await ctx.http().get(`/api/v1/blog/posts/${draft.slug}`).expect(200)).body.data;
    expect(pub).toMatchObject({
      title: 'Where to live in Lagos',
      authorName: 'Admin User',
      readingMinutes: 1,
    });

    await ctx.http().post(`${BLOG}/posts/${draft.id}/unpublish`).set(auth).expect(200);
    await ctx.http().get(`/api/v1/blog/posts/${draft.slug}`).expect(404);
  });

  it('search, categories, tags and related posts only surface published posts', async () => {
    const auth = (await adminAuth(ctx, ['content_manager'])).auth;
    const cats = (
      await ctx.http().post(`${BLOG}/categories`).set(auth).send({ name: 'Guides' }).expect(201)
    ).body.data;
    const guides = cats[0];
    const tags = (
      await ctx.http().post(`${BLOG}/tags`).set(auth).send({ name: 'Lagos' }).expect(201)
    ).body.data;
    const a = await post(auth, { categoryId: guides.id, tagIds: [tags[0].id] });
    const b = await post(auth, {
      title: 'Abuja weekend ideas',
      body: 'Parks, markets and food in Abuja.',
      relatedIds: [a.id],
    });
    const hidden = await post(auth, { title: 'Secret Lekki draft', body: 'Lekki draft content.' });
    await ctx.http().post(`${BLOG}/posts/${a.id}/publish`).set(auth).send({}).expect(200);
    await ctx.http().post(`${BLOG}/posts/${b.id}/publish`).set(auth).send({}).expect(200);

    const search = (await ctx.http().get('/api/v1/blog/posts?q=lekki beach').expect(200)).body.data;
    expect(search.items.map((p: { id: string }) => p.id)).toEqual([a.id]);
    const byCat = (await ctx.http().get('/api/v1/blog/posts?category=guides').expect(200)).body
      .data;
    expect(byCat.items.map((p: { id: string }) => p.id)).toEqual([a.id]);
    const byTag = (await ctx.http().get('/api/v1/blog/posts?tag=lagos').expect(200)).body.data;
    expect(byTag.total).toBe(1);
    const detail = (await ctx.http().get(`/api/v1/blog/posts/${b.slug}`).expect(200)).body.data;
    expect(detail.related.map((p: { id: string }) => p.id)).toEqual([a.id]);
    expect((await ctx.http().get('/api/v1/blog/categories').expect(200)).body.data).toHaveLength(1);
    await ctx
      .http()
      .patch(`${BLOG}/posts/${b.id}`)
      .set(auth)
      .send({ relatedIds: [b.id] })
      .expect(422);
    await ctx
      .http()
      .patch(`${BLOG}/posts/${b.id}`)
      .set(auth)
      .send({ relatedIds: [hidden.id] })
      .expect(200);
    // A related post that is not public is never shown.
    expect(
      (await ctx.http().get(`/api/v1/blog/posts/${b.slug}`).expect(200)).body.data.related,
    ).toEqual([]);
    // Categories and tags in use cannot be deleted.
    await ctx.http().delete(`${BLOG}/categories/${guides.id}`).set(auth).expect(409);
    await ctx.http().delete(`${BLOG}/tags/${tags[0].id}`).set(auth).expect(409);
    await ctx.http().get("/api/v1/blog/posts?q=' OR 1=1 --").expect(200);
  });

  it('each action needs its own permission; live posts need publish rights to edit', async () => {
    const marketing = (await adminAuth(ctx, ['marketing_manager'])).auth;
    const content = (await adminAuth(ctx, ['content_manager'])).auth;
    const finance = (await adminAuth(ctx, ['finance_admin'])).auth;
    await ctx.http().get(`${BLOG}/posts`).set(finance).expect(403);
    const p = await post(marketing);
    await ctx.http().post(`${BLOG}/posts/${p.id}/publish`).set(marketing).send({}).expect(403);
    await ctx.http().post(`${BLOG}/posts/${p.id}/publish`).set(content).send({}).expect(200);
    await ctx
      .http()
      .patch(`${BLOG}/posts/${p.id}`)
      .set(marketing)
      .send({ title: 'Changed live title' })
      .expect(403);
    await ctx
      .http()
      .patch(`${BLOG}/posts/${p.id}`)
      .set(content)
      .send({ title: 'Changed live title' })
      .expect(200);
    await ctx.http().delete(`${BLOG}/posts/${p.id}`).set(content).expect(409);
    await ctx.http().post(`${BLOG}/posts/${p.id}/archive`).set(marketing).expect(403);
    await ctx.http().post(`${BLOG}/posts/${p.id}/archive`).set(content).expect(200);
    await ctx.http().delete(`${BLOG}/posts/${p.id}`).set(content).expect(200);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'cms.blog.post_deleted' },
    });
    expect(audit?.before).toMatchObject({ title: 'Changed live title', status: 'ARCHIVED' });
  });

  it('a disabled blog is not public', async () => {
    const auth = (await adminAuth(ctx, ['content_manager'])).auth;
    await ctx
      .http()
      .patch('/api/v1/admin/cms/site')
      .set(auth)
      .send({ blogEnabled: false })
      .expect(200);
    await ctx.http().get('/api/v1/blog/posts').expect(404);
    await ctx.http().get('/api/v1/blog/categories').expect(404);
  });

  it('rejects unsafe canonical URLs and unknown fields', async () => {
    const auth = (await adminAuth(ctx, ['content_manager'])).auth;
    for (const extra of [
      { canonicalUrl: 'javascript:alert(1)' },
      { canonicalUrl: 'http://x.example' },
      { authorId: 'x' },
    ]) {
      await ctx
        .http()
        .post(`${BLOG}/posts`)
        .set(auth)
        .send({ title: 'Some post title', ...extra })
        .expect(422);
    }
  });
});

describe('help centre', () => {
  it('is off until enabled; articles, FAQs and search show published content only', async () => {
    const auth = (await adminAuth(ctx, ['support_admin'])).auth;
    await ctx.http().get('/api/v1/help/categories').expect(404);
    await ctx
      .http()
      .patch('/api/v1/admin/cms/site')
      .set(auth)
      .send({ helpCenterEnabled: true })
      .expect(403);
    await ctx
      .http()
      .patch('/api/v1/admin/cms/site')
      .set((await adminAuth(ctx, ['content_manager'])).auth)
      .send({ helpCenterEnabled: true })
      .expect(200);

    const cats = (
      await ctx.http().post(`${HELP}/categories`).set(auth).send({ name: 'Payments' }).expect(201)
    ).body.data;
    const cat = cats[0];
    const article = (
      await ctx
        .http()
        .post(`${HELP}/articles`)
        .set(auth)
        .send({
          title: 'How refunds work',
          body: 'Refunds go back to your card within ten days.',
          categoryId: cat.id,
        })
        .expect(201)
    ).body.data;
    await ctx.http().get(`/api/v1/help/articles/${article.slug}`).expect(404);
    expect((await ctx.http().get('/api/v1/help/categories').expect(200)).body.data).toEqual([]);
    await ctx
      .http()
      .post(`${HELP}/articles/${article.id}/status`)
      .set(auth)
      .send({ status: 'PUBLISHED' })
      .expect(200);
    await ctx.http().get(`/api/v1/help/articles/${article.slug}`).expect(200);
    await ctx
      .http()
      .post(`${HELP}/faqs`)
      .set(auth)
      .send({ question: 'Can I pay by transfer?', answer: 'Yes, at checkout.', published: true })
      .expect(201);
    await ctx
      .http()
      .post(`${HELP}/faqs`)
      .set(auth)
      .send({ question: 'Hidden question here', answer: 'Draft answer.' })
      .expect(201);
    const search = (await ctx.http().get('/api/v1/help/search?q=refund').expect(200)).body.data;
    expect(search.articles.map((a: { id: string }) => a.id)).toEqual([article.id]);
    const faqs = (await ctx.http().get('/api/v1/help/faqs').expect(200)).body.data;
    expect(faqs.map((f: { question: string }) => f.question)).toEqual(['Can I pay by transfer?']);
    const category = (await ctx.http().get(`/api/v1/help/categories/${cat.slug}`).expect(200)).body
      .data;
    expect(category.articles).toHaveLength(1);
    await ctx.http().delete(`${HELP}/categories/${cat.id}`).set(auth).expect(409);
    await ctx.http().delete(`${HELP}/articles/${article.id}`).set(auth).expect(409);
    await ctx
      .http()
      .get(`${HELP}/articles`)
      .set((await adminAuth(ctx, ['finance_admin'])).auth)
      .expect(403);
  });
});
