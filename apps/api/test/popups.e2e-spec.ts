import type { AdminPopupView, PublicPopupView } from '@havenhub/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { adminAuth, customer } from './helpers/booking-helpers';
import {
  createAgent,
  createDraft,
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

const ADMIN = '/api/v1/admin/popups';
let admin: Record<string, string>;
beforeEach(async () => {
  admin = (await adminAuth(ctx, ['super_admin'])).auth;
});

async function create(body: Record<string, unknown>, expected = 201) {
  const res = await ctx.http().post(ADMIN).set(admin).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(expected);
  return res.body.data as AdminPopupView;
}

const publicList = async () =>
  (await ctx.http().get('/api/v1/popups').expect(200)).body.data as PublicPopupView[];

const BASE = { name: 'Launch', kind: 'ANNOUNCEMENT', title: 'We are live' };

describe('pop-ups', () => {
  it('appear publicly only while active and not ended, highest priority first', async () => {
    const draft = await create({ ...BASE, name: 'Draft' });
    expect(draft.active).toBe(false);
    await create({ ...BASE, name: 'Low', title: 'Low', active: true, priority: 1 });
    await create({
      ...BASE,
      name: 'High',
      title: 'High',
      active: true,
      priority: 5,
      kind: 'OFFER',
      discountCode: 'stay10',
      ctaLabel: 'See rentals',
      ctaLink: '/properties',
      audience: 'GUESTS',
      paths: ['/', '/properties'],
      frequency: 'DAILY',
      delaySeconds: 4,
    });
    await create({
      ...BASE,
      name: 'Ended',
      active: true,
      startsAt: '2026-01-01T00:00:00Z',
      endsAt: '2026-02-01T00:00:00Z',
    });

    const list = await publicList();
    expect(list.map((p) => p.title)).toEqual(['High', 'Low']);
    expect(list[0]).toMatchObject({
      kind: 'OFFER',
      discountCode: 'STAY10',
      ctaLabel: 'See rentals',
      ctaLink: '/properties',
      audience: 'GUESTS',
      paths: ['/', '/properties'],
      frequency: 'DAILY',
      delaySeconds: 4,
    });
    // Nothing internal leaks to the public.
    expect(list[0]).not.toHaveProperty('name');
    expect(list[0]).not.toHaveProperty('views');

    // Switching one on shows it at once (the cache is invalidated on change).
    await ctx.http().patch(`${ADMIN}/${draft.id}`).set(admin).send({ active: true }).expect(200);
    expect((await publicList()).map((p) => p.title)).toContain('We are live');
  });

  it('feature a property by its address, only while the property is public', async () => {
    const agent = await createAgent(ctx);
    const live = await createPublished(ctx, agent, { discountPercent: 10 });
    const popup = await create({
      ...BASE,
      kind: 'PROPERTY',
      title: 'Featured stay',
      property: `https://havenhub.ng/properties/${live.slug}?utm=x`,
      active: true,
    });
    expect(popup.propertySlug).toBe(live.slug);
    const [shown] = await publicList();
    expect(shown!.property).toMatchObject({
      slug: live.slug,
      discountPercent: 10,
    });
    expect(shown!.property!.imageUrl).toBeTruthy();

    // Unpublished: the pop-up stops showing (it is not deleted).
    await ctx.prisma.property.update({ where: { id: live.id }, data: { status: 'ARCHIVED' } });
    await ctx.http().patch(`${ADMIN}/${popup.id}`).set(admin).send({ priority: 1 }).expect(200);
    expect(await publicList()).toEqual([]);

    await create({ ...BASE, kind: 'PROPERTY', property: 'no-such-place' }, 422);
    const draft = await createDraft(ctx, agent);
    // A draft can be chosen (it shows once published).
    await create({ ...BASE, kind: 'PROPERTY', property: draft.slug });
  });

  it('count views, clicks and closes, without revealing unknown pop-ups', async () => {
    const popup = await create({ ...BASE, active: true });
    const event = (id: string, type: string) =>
      ctx.http().post(`/api/v1/popups/${id}/events`).send({ type });
    await event(popup.id, 'VIEW').expect(204);
    await event(popup.id, 'VIEW').expect(204);
    await event(popup.id, 'CLICK').expect(204);
    await event(popup.id, 'DISMISS').expect(204);
    await event('0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', 'VIEW').expect(204);
    await event(popup.id, 'HACK').expect(422);

    const after = (await ctx.http().get(`${ADMIN}/${popup.id}`).set(admin).expect(200)).body
      .data as AdminPopupView;
    expect(after).toMatchObject({ views: 2, clicks: 1, dismissals: 1 });
  });

  it('validate the button, links, image and schedule', async () => {
    await create({ ...BASE, ctaLabel: 'Go' }, 422);
    await create({ ...BASE, ctaLabel: 'Go', ctaLink: 'https://evil.example' }, 422);
    await create({ ...BASE, imageId: '0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }, 422);
    await create({ ...BASE, paths: ['properties'] }, 422);
    await create({ ...BASE, kind: 'PROPERTY' }, 422);
    const popup = await create({ ...BASE, ctaLabel: 'Go', ctaLink: '/properties' });
    // Removing only the link would leave half a button.
    await ctx.http().patch(`${ADMIN}/${popup.id}`).set(admin).send({ ctaLink: null }).expect(422);
    await ctx
      .http()
      .patch(`${ADMIN}/${popup.id}`)
      .set(admin)
      .send({ ctaLink: null, ctaLabel: null })
      .expect(200);
  });

  it('need popups.manage, and every change is audited', async () => {
    const c = await customer(ctx);
    await ctx.http().get(ADMIN).set(c.auth).expect(403);
    const finance = await adminAuth(ctx, ['finance_admin']);
    await ctx.http().get(ADMIN).set(finance.auth).expect(403);
    const content = await adminAuth(ctx, ['content_manager']);
    await ctx.http().get(ADMIN).set(content.auth).expect(200);

    const popup = await create(BASE);
    await ctx.http().patch(`${ADMIN}/${popup.id}`).set(admin).send({ active: true }).expect(200);
    await ctx.http().delete(`${ADMIN}/${popup.id}`).set(admin).expect(200);
    await ctx.http().get(`${ADMIN}/${popup.id}`).set(admin).expect(404);
    const actions = (
      await ctx.prisma.auditLog.findMany({
        where: { resourceType: 'popup' },
        orderBy: { createdAt: 'asc' },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(['cms.popup.created', 'cms.popup.updated', 'cms.popup.deleted']);
  });
});
