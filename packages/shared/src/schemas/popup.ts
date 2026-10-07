import { z } from 'zod';

import type { AccountType } from '../enums/account.js';
import type { CmsImage } from '../types/cms.js';
import { paginationQuerySchema } from './admin.js';
import { discountCodeField } from './discount.js';
import { relativeLinkField } from './notification.js';

/** What a pop-up is for; each kind has its own look on the site. */
export const PopupKind = {
  ANNOUNCEMENT: 'ANNOUNCEMENT',
  WHATS_NEW: 'WHATS_NEW',
  OFFER: 'OFFER',
  PROPERTY: 'PROPERTY',
} as const;
export type PopupKind = (typeof PopupKind)[keyof typeof PopupKind];

export const POPUP_KIND_LABELS: Record<PopupKind, string> = {
  ANNOUNCEMENT: 'Announcement',
  WHATS_NEW: 'What’s new',
  OFFER: 'Offer or discount',
  PROPERTY: 'Featured property',
};

export const PopupAudience = {
  ALL: 'ALL',
  GUESTS: 'GUESTS',
  CUSTOMERS: 'CUSTOMERS',
  AGENTS: 'AGENTS',
} as const;
export type PopupAudience = (typeof PopupAudience)[keyof typeof PopupAudience];

export const POPUP_AUDIENCE_LABELS: Record<PopupAudience, string> = {
  ALL: 'Everyone',
  GUESTS: 'Visitors who are not signed in',
  CUSTOMERS: 'Signed-in customers',
  AGENTS: 'Signed-in agents',
};

/** How often one browser sees it (kept in the visitor's own browser). */
export const PopupFrequency = {
  ONCE: 'ONCE',
  DAILY: 'DAILY',
  EVERY_VISIT: 'EVERY_VISIT',
} as const;
export type PopupFrequency = (typeof PopupFrequency)[keyof typeof PopupFrequency];

export const POPUP_FREQUENCY_LABELS: Record<PopupFrequency, string> = {
  ONCE: 'Once (until the content changes)',
  DAILY: 'At most once a day',
  EVERY_VISIT: 'Once per visit',
};

/**
 * Never shown here, whatever a pop-up's pages say: administration, sign-in
 * and account recovery, and payment steps.
 */
export const POPUP_EXCLUDED_PREFIXES = [
  '/admin',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/check-email',
  '/status',
  '/agent/subscription/payment',
  '/agent/subscription/test-checkout',
] as const;

const underPrefix = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/** "/" means the homepage only; any other entry also matches the pages below it. */
export function popupMatchesPath(paths: readonly string[], pathname: string): boolean {
  if (POPUP_EXCLUDED_PREFIXES.some((p) => underPrefix(pathname, p))) return false;
  if (pathname.includes('/test-checkout') || pathname.endsWith('/payment')) return false;
  if (paths.length === 0) {
    // All public pages: not the signed-in dashboards.
    return !['/account', '/agent'].some((p) => underPrefix(pathname, p));
  }
  return paths.some((p) => (p === '/' ? pathname === '/' : underPrefix(pathname, p)));
}

export function popupMatchesAudience(audience: PopupAudience, viewer: AccountType | null): boolean {
  switch (audience) {
    case 'ALL':
      return viewer !== 'ADMIN';
    case 'GUESTS':
      return viewer === null;
    case 'CUSTOMERS':
      return viewer === 'CUSTOMER';
    case 'AGENTS':
      return viewer === 'AGENT';
  }
}

/** Whether `popup` may show to this viewer on this page now (frequency aside). */
export function popupEligible(
  popup: Pick<PublicPopupView, 'audience' | 'paths' | 'startsAt' | 'endsAt'>,
  context: { pathname: string; viewer: AccountType | null; now: Date },
): boolean {
  if (popup.startsAt && context.now < new Date(popup.startsAt)) return false;
  if (popup.endsAt && context.now >= new Date(popup.endsAt)) return false;
  return (
    popupMatchesAudience(popup.audience, context.viewer) &&
    popupMatchesPath(popup.paths, context.pathname)
  );
}

// ── Admin input ──

const pathEntry = z
  .string()
  .trim()
  .max(200)
  .regex(/^\/[a-z0-9\-/]*$/, 'Use a path such as / or /properties');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();

const isoDateTime = z.iso
  .datetime({ offset: true })
  .nullable()
  .optional()
  .transform((v): Date | null | undefined => (v == null ? v : new Date(v)));

const popupFields = {
  name: z.string().trim().min(2, 'Enter a name').max(120),
  kind: z.enum(PopupKind),
  title: z.string().trim().min(2, 'Enter a title').max(120),
  body: optionalText(600),
  imageId: z.uuid().nullable().optional(),
  /** PROPERTY pop-ups: the property's slug (or its page address). */
  property: z
    .string()
    .trim()
    .max(300)
    .transform((v) => {
      const slug = v.replace(/^https?:\/\/[^/]+/, '').replace(/^\/properties\//, '');
      return slug.replace(/[/?#].*$/, '') || null;
    })
    .nullable()
    .optional(),
  discountCode: discountCodeField.nullable().optional(),
  ctaLabel: optionalText(40),
  ctaLink: relativeLinkField.nullable().optional(),
  audience: z.enum(PopupAudience).optional(),
  paths: z
    .array(pathEntry)
    .max(20)
    .transform((v) => [...new Set(v)])
    .optional(),
  frequency: z.enum(PopupFrequency).optional(),
  delaySeconds: z.number().int().min(0).max(60).optional(),
  priority: z.number().int().min(-100).max(100).optional(),
  active: z.boolean().optional(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
};

const window = (v: { startsAt?: Date | null; endsAt?: Date | null }) =>
  !v.startsAt || !v.endsAt || v.startsAt < v.endsAt;
const WINDOW = { path: ['endsAt'], message: 'The end must be after the start' };
/** A button needs both a label and a link, or neither. */
export const ctaComplete = (v: { ctaLabel?: string | null; ctaLink?: string | null }) =>
  (v.ctaLabel == null) === (v.ctaLink == null);
const CTA = { path: ['ctaLink'], message: 'A button needs both a label and a link' };

export const createPopupSchema = z
  .object(popupFields)
  .strict()
  .refine(window, WINDOW)
  .refine(ctaComplete, CTA)
  .refine((v) => v.kind !== 'PROPERTY' || Boolean(v.property), {
    path: ['property'],
    message: 'Choose the property to feature',
  });
export type CreatePopupInput = z.input<typeof createPopupSchema>;

export const updatePopupSchema = z
  .object(popupFields)
  .partial()
  .strict()
  .refine(window, WINDOW)
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdatePopupInput = z.input<typeof updatePopupSchema>;

export const popupListQuerySchema = paginationQuerySchema;

export const popupEventSchema = z.object({ type: z.enum(['VIEW', 'CLICK', 'DISMISS']) }).strict();

// ── Views ──

export interface PopupPropertyCard {
  slug: string;
  title: string;
  city: string | null;
  state: string | null;
  priceKobo: number | null;
  pricingPeriod: string | null;
  discountPercent: number | null;
  imageUrl: string | null;
}

/** What the public site needs to decide and render. */
export interface PublicPopupView {
  id: string;
  /** Changes when the content changes, so "once" pop-ups show again after an edit. */
  version: string;
  kind: PopupKind;
  title: string;
  body: string | null;
  image: CmsImage | null;
  property: PopupPropertyCard | null;
  discountCode: string | null;
  ctaLabel: string | null;
  ctaLink: string | null;
  audience: PopupAudience;
  paths: string[];
  frequency: PopupFrequency;
  delaySeconds: number;
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
}

export interface AdminPopupView extends PublicPopupView {
  name: string;
  active: boolean;
  /** The property as entered, even while it is not publicly visible. */
  propertySlug: string | null;
  views: number;
  clicks: number;
  dismissals: number;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}
