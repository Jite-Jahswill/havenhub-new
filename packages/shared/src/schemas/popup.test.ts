import { describe, expect, it } from 'vitest';

import {
  createPopupSchema,
  popupEligible,
  popupMatchesAudience,
  popupMatchesPath,
} from './popup.js';

describe('pop-up targeting', () => {
  it('"all pages" means public pages: not dashboards, admin, sign-in or payment', () => {
    for (const path of ['/', '/properties', '/properties/lekki-flat', '/events', '/blog/x']) {
      expect(popupMatchesPath([], path), path).toBe(true);
    }
    for (const path of [
      '/admin',
      '/admin/popups',
      '/account',
      '/agent/properties',
      '/login',
      '/register/agent',
      '/reset-password',
      '/agent/subscription/payment',
      '/account/bookings/abc/test-checkout',
    ]) {
      expect(popupMatchesPath([], path), path).toBe(false);
    }
  });

  it('"/" is the homepage only; other entries include the pages below them', () => {
    expect(popupMatchesPath(['/'], '/')).toBe(true);
    expect(popupMatchesPath(['/'], '/properties')).toBe(false);
    expect(popupMatchesPath(['/properties'], '/properties/lekki-flat')).toBe(true);
    expect(popupMatchesPath(['/properties'], '/properties-for-sale')).toBe(false);
    // Dashboards only when asked for, and never admin or payment steps.
    expect(popupMatchesPath(['/agent'], '/agent/properties')).toBe(true);
    expect(popupMatchesPath(['/admin'], '/admin')).toBe(false);
    expect(popupMatchesPath(['/agent'], '/agent/subscription/payment')).toBe(false);
  });

  it('match the audience; administrators never see "everyone" pop-ups', () => {
    expect(popupMatchesAudience('ALL', null)).toBe(true);
    expect(popupMatchesAudience('ALL', 'CUSTOMER')).toBe(true);
    expect(popupMatchesAudience('ALL', 'ADMIN')).toBe(false);
    expect(popupMatchesAudience('GUESTS', null)).toBe(true);
    expect(popupMatchesAudience('GUESTS', 'CUSTOMER')).toBe(false);
    expect(popupMatchesAudience('AGENTS', 'AGENT')).toBe(true);
    expect(popupMatchesAudience('AGENTS', 'CUSTOMER')).toBe(false);
  });

  it('respect the schedule (end exclusive)', () => {
    const now = new Date('2026-10-11T12:00:00Z');
    const popup = { audience: 'ALL' as const, paths: [], startsAt: null, endsAt: null };
    const ctx = { pathname: '/', viewer: null, now };
    expect(popupEligible(popup, ctx)).toBe(true);
    expect(popupEligible({ ...popup, startsAt: '2026-10-12T00:00:00Z' }, ctx)).toBe(false);
    expect(popupEligible({ ...popup, endsAt: now.toISOString() }, ctx)).toBe(false);
  });
});

describe('pop-up input', () => {
  const base = { name: 'Launch', kind: 'ANNOUNCEMENT', title: 'We are live' };

  it('needs a complete button, a property for property pop-ups and an end after the start', () => {
    expect(createPopupSchema.safeParse(base).success).toBe(true);
    expect(createPopupSchema.safeParse({ ...base, ctaLabel: 'Go' }).success).toBe(false);
    expect(
      createPopupSchema.safeParse({ ...base, ctaLabel: 'Go', ctaLink: '/properties' }).success,
    ).toBe(true);
    expect(
      createPopupSchema.safeParse({ ...base, ctaLabel: 'Go', ctaLink: 'https://evil.example' })
        .success,
    ).toBe(false);
    expect(createPopupSchema.safeParse({ ...base, kind: 'PROPERTY' }).success).toBe(false);
    expect(
      createPopupSchema.safeParse({
        ...base,
        startsAt: '2026-10-12T00:00:00Z',
        endsAt: '2026-10-11T00:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('accept a property link or slug and keep the slug', () => {
    for (const property of [
      'lekki-flat',
      '/properties/lekki-flat',
      'https://havenhub.ng/properties/lekki-flat?ref=x',
    ]) {
      expect(createPopupSchema.parse({ ...base, kind: 'PROPERTY', property }).property).toBe(
        'lekki-flat',
      );
    }
  });

  it('only accept page paths for targeting', () => {
    expect(createPopupSchema.safeParse({ ...base, paths: ['/', '/properties'] }).success).toBe(
      true,
    );
    expect(createPopupSchema.safeParse({ ...base, paths: ['properties'] }).success).toBe(false);
    expect(createPopupSchema.safeParse({ ...base, paths: ['/a b'] }).success).toBe(false);
  });
});
