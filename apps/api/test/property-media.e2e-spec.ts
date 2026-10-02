import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createAgent,
  createDraft,
  createPublished,
  createTestContext,
  testImage,
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

describe('image uploads', () => {
  it('stores re-encoded WebP renditions without EXIF metadata and serves them', async () => {
    const agent = await createAgent(ctx);
    const draft = await createDraft(ctx, agent);
    const res = await uploadImage(ctx, agent, draft.id);
    const [image] = res.body.data.images;
    expect(image).toMatchObject({ isPrimary: true, width: 1200, height: 800 });
    expect(image.url).toMatch(/^\/api\/media\/properties\/.+-lg\.webp$/);

    const file = await ctx.http().get(image.url).buffer(true).expect(200);
    expect(file.headers['content-type']).toBe('image/webp');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    const meta = await sharp(file.body as Buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect((file.body as Buffer).includes('secret-camera-owner')).toBe(false);

    const thumb = await ctx.http().get(image.thumbnailUrl).buffer(true).expect(200);
    expect((await sharp(thumb.body as Buffer).metadata()).width).toBe(640);
  });

  it('rejects files that are not images, regardless of name or declared type', async () => {
    const agent = await createAgent(ctx);
    const draft = await createDraft(ctx, agent);
    const res = await ctx
      .http()
      .post(`${BASE}/${draft.id}/images`)
      .set(agent.auth)
      .attach('file', Buffer.from('<script>alert(1)</script>'.repeat(50)), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      })
      .expect(422);
    expect(res.body.code).toBe('INVALID_FILE');
    expect(await ctx.prisma.propertyImage.count()).toBe(0);
  });

  it('rejects images that are too small or too large', async () => {
    const agent = await createAgent(ctx);
    const draft = await createDraft(ctx, agent);
    await uploadImage(ctx, agent, draft.id, 422, await testImage(100, 100));
    const huge = Buffer.alloc(11 * 1024 * 1024, 1);
    const res = await ctx
      .http()
      .post(`${BASE}/${draft.id}/images`)
      .set(agent.auth)
      .attach('file', huge, { filename: 'big.jpg', contentType: 'image/jpeg' });
    expect([413, 422]).toContain(res.status);
    expect(res.body.code).toBe('INVALID_FILE');
  });

  it('requires a file', async () => {
    const agent = await createAgent(ctx);
    const draft = await createDraft(ctx, agent);
    const res = await ctx.http().post(`${BASE}/${draft.id}/images`).set(agent.auth).expect(422);
    expect(res.body.code).toBe('INVALID_FILE');
  });

  it('[11] enforces the per-property image limit', async () => {
    const agent = await createAgent(ctx);
    const draft = await createDraft(ctx, agent);
    const image = await testImage(400, 300);
    for (let i = 0; i < 10; i++) await uploadImage(ctx, agent, draft.id, 201, image);
    const res = await uploadImage(ctx, agent, draft.id, 403, image);
    expect(res.body.code).toBe('PLAN_LIMIT_REACHED');
    expect(await ctx.prisma.propertyImage.count({ where: { propertyId: draft.id } })).toBe(10);
  });
});

describe('managing images', () => {
  it('reorders, changes the primary image and promotes a new primary on delete', async () => {
    const agent = await createAgent(ctx);
    const draft = await createDraft(ctx, agent);
    await uploadImage(ctx, agent, draft.id, 201, await testImage(400, 300));
    const res = await uploadImage(
      ctx,
      agent,
      draft.id,
      201,
      await testImage(400, 300, { r: 0, g: 0, b: 0 }),
    );
    const [first, second] = res.body.data.images as { id: string; isPrimary: boolean }[];
    expect([first!.isPrimary, second!.isPrimary]).toEqual([true, false]);

    const reordered = await ctx
      .http()
      .patch(`${BASE}/${draft.id}/images/order`)
      .set(agent.auth)
      .send({ imageIds: [second!.id, first!.id] })
      .expect(200);
    expect(reordered.body.data.images.map((i: { id: string }) => i.id)).toEqual([
      second!.id,
      first!.id,
    ]);

    await ctx
      .http()
      .patch(`${BASE}/${draft.id}/images/order`)
      .set(agent.auth)
      .send({ imageIds: [first!.id] })
      .expect(400);

    const primary = await ctx
      .http()
      .patch(`${BASE}/${draft.id}/images/${second!.id}`)
      .set(agent.auth)
      .send({ isPrimary: true, altText: 'Living room' })
      .expect(200);
    expect(
      primary.body.data.images
        .filter((i: { isPrimary: boolean }) => i.isPrimary)
        .map((i: { id: string }) => i.id),
    ).toEqual([second!.id]);

    const afterDelete = await ctx
      .http()
      .delete(`${BASE}/${draft.id}/images/${second!.id}`)
      .set(agent.auth)
      .expect(200);
    expect(afterDelete.body.data.images).toEqual([
      expect.objectContaining({ id: first!.id, isPrimary: true }),
    ]);
  });

  it("[5] agent A cannot delete or modify agent B's media", async () => {
    const a = await createAgent(ctx);
    const b = await createAgent(ctx);
    const aDraft = await createDraft(ctx, a);
    const bDraft = await createDraft(ctx, b);
    const bImage = (await uploadImage(ctx, b, bDraft.id)).body.data.images[0].id as string;

    // Via B's property id…
    await ctx.http().delete(`${BASE}/${bDraft.id}/images/${bImage}`).set(a.auth).expect(404);
    await ctx
      .http()
      .patch(`${BASE}/${bDraft.id}/images/${bImage}`)
      .set(a.auth)
      .send({ altText: 'x' })
      .expect(404);
    // …and by smuggling B's image id under A's own property.
    await ctx.http().delete(`${BASE}/${aDraft.id}/images/${bImage}`).set(a.auth).expect(404);
    await ctx
      .http()
      .patch(`${BASE}/${aDraft.id}/images/${bImage}`)
      .set(a.auth)
      .send({ isPrimary: true })
      .expect(404);
    await ctx
      .http()
      .patch(`${BASE}/${aDraft.id}/images/order`)
      .set(a.auth)
      .send({ imageIds: [bImage] })
      .expect(400);

    const image = await ctx.prisma.propertyImage.findUniqueOrThrow({ where: { id: bImage } });
    expect(image.propertyId).toBe(bDraft.id);
    expect(image.altText).toBeNull();
  });

  it('keeps at least one image on a published listing', async () => {
    const agent = await createAgent(ctx);
    const property = await createPublished(ctx, agent);
    const detail = await ctx.http().get(`${BASE}/${property.id}`).set(agent.auth).expect(200);
    const res = await ctx
      .http()
      .delete(`${BASE}/${property.id}/images/${detail.body.data.images[0].id}`)
      .set(agent.auth)
      .expect(409);
    expect(res.body.code).toBe('PROPERTY_LOCKED');
  });

  it('adding media to a published listing sends it back to review', async () => {
    const agent = await createAgent(ctx);
    const property = await createPublished(ctx, agent);
    const res = await uploadImage(ctx, agent, property.id);
    expect(res.body.data.status).toBe('PENDING_REVIEW');
    await ctx.http().get(`/api/v1/properties/${property.slug}`).expect(404);
  });
});

describe('videos', () => {
  it('accepts YouTube and Vimeo links, stores only the id, and enforces the limit', async () => {
    const agent = await createAgent(ctx);
    const draft = await createDraft(ctx, agent);
    const res = await ctx
      .http()
      .post(`${BASE}/${draft.id}/videos`)
      .set(agent.auth)
      .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', title: 'Walkthrough' })
      .expect(201);
    expect(res.body.data.videos).toEqual([
      expect.objectContaining({
        provider: 'YOUTUBE',
        externalId: 'dQw4w9WgXcQ',
        embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      }),
    ]);
    const limit = await ctx
      .http()
      .post(`${BASE}/${draft.id}/videos`)
      .set(agent.auth)
      .send({ url: 'https://vimeo.com/76979871' })
      .expect(403);
    expect(limit.body.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('rejects other links', async () => {
    const agent = await createAgent(ctx);
    const draft = await createDraft(ctx, agent);
    for (const url of [
      'https://evil.example/video.mp4',
      'javascript:alert(1)',
      'https://youtube.com/watch?v=short',
    ]) {
      await ctx.http().post(`${BASE}/${draft.id}/videos`).set(agent.auth).send({ url }).expect(422);
    }
  });

  it("[5] agent A cannot delete agent B's video", async () => {
    const a = await createAgent(ctx);
    const b = await createAgent(ctx);
    const aDraft = await createDraft(ctx, a);
    const bDraft = await createDraft(ctx, b);
    const video = await ctx
      .http()
      .post(`${BASE}/${bDraft.id}/videos`)
      .set(b.auth)
      .send({ url: 'https://youtu.be/dQw4w9WgXcQ' })
      .expect(201);
    const videoId = video.body.data.videos[0].id as string;
    await ctx.http().delete(`${BASE}/${bDraft.id}/videos/${videoId}`).set(a.auth).expect(404);
    await ctx.http().delete(`${BASE}/${aDraft.id}/videos/${videoId}`).set(a.auth).expect(404);
    expect(await ctx.prisma.propertyVideo.count({ where: { id: videoId } })).toBe(1);
  });
});

describe('media serving', () => {
  it('refuses path traversal and unknown files', async () => {
    await ctx.http().get('/api/media/..%2F..%2Fetc%2Fpasswd').expect(404);
    await ctx.http().get('/api/media/properties/../../package.json').expect(404);
    await ctx.http().get('/api/media/properties/missing-lg.webp').expect(404);
  });
});
