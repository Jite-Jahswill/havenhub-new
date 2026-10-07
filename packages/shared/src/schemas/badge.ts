import { z } from 'zod';

import type { CmsImage } from '../types/cms.js';

export const BadgeMode = { MANUAL: 'MANUAL', AUTOMATIC: 'AUTOMATIC' } as const;
export type BadgeMode = (typeof BadgeMode)[keyof typeof BadgeMode];

/** The rules of an AUTOMATIC badge; every rule that is set must hold. */
export interface BadgeRules {
  minRating: number | null;
  minReviews: number | null;
  minCompletedBookings: number | null;
}

/** Property stats the rules are checked against. */
export interface BadgeStats {
  ratingSum: number;
  reviewCount: number;
  completedBookings: number;
}

/**
 * Whether a property earns an AUTOMATIC badge. A rating rule needs at least
 * one review (no reviews is not "5 stars"). Mirrors the SQL the API uses.
 */
export function qualifiesForBadge(rules: BadgeRules, stats: BadgeStats): boolean {
  if (rules.minRating !== null) {
    if (stats.reviewCount === 0) return false;
    // Compare sums, not rounded averages: avg ≥ r  ⇔  sum ≥ r × count.
    if (stats.ratingSum < rules.minRating * stats.reviewCount - 1e-9) return false;
  }
  if (rules.minReviews !== null && stats.reviewCount < rules.minReviews) return false;
  if (rules.minCompletedBookings !== null && stats.completedBookings < rules.minCompletedBookings) {
    return false;
  }
  return true;
}

const ruleFields = {
  /** 1.0–5.0 in steps of 0.1. */
  minRating: z
    .number()
    .min(1)
    .max(5)
    .refine((v) => Math.round(v * 10) === v * 10, 'Use one decimal place, e.g. 4.8')
    .nullable()
    .optional(),
  minReviews: z.number().int().min(0).max(100_000).nullable().optional(),
  minCompletedBookings: z.number().int().min(0).max(100_000).nullable().optional(),
};

const badgeFields = {
  name: z.string().trim().min(2, 'Enter a name').max(60),
  description: z
    .string()
    .trim()
    .max(200)
    .transform((v) => v || null)
    .nullable()
    .optional(),
  imageId: z.uuid('Choose an image'),
  mode: z.enum(BadgeMode),
  ...ruleFields,
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
};

const hasRule = (v: Partial<BadgeRules>) =>
  v.minRating != null || v.minReviews != null || v.minCompletedBookings != null;

export const createBadgeSchema = z
  .object(badgeFields)
  .strict()
  .refine((v) => v.mode !== 'AUTOMATIC' || hasRule(v), {
    path: ['minRating'],
    message: 'An automatic badge needs at least one rule',
  });
export type CreateBadgeInput = z.input<typeof createBadgeSchema>;

export const updateBadgeSchema = z
  .object(badgeFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateBadgeInput = z.input<typeof updateBadgeSchema>;

/** A property, by its page address or slug. */
export const badgeAssignmentSchema = z
  .object({
    property: z
      .string()
      .trim()
      .min(1, 'Enter the property')
      .max(300)
      .transform((v) =>
        v
          .replace(/^https?:\/\/[^/]+/, '')
          .replace(/^\/properties\//, '')
          .replace(/[/?#].*$/, ''),
      ),
  })
  .strict();

/** On cards and pages. */
export interface PublicBadge {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string;
}

export interface AdminBadgeView extends BadgeRules {
  id: string;
  name: string;
  description: string | null;
  image: CmsImage;
  mode: BadgeMode;
  active: boolean;
  sortOrder: number;
  /** Properties holding it now. */
  holders: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminBadgeDetail extends AdminBadgeView {
  /** Up to 200 properties holding it, and how they got it. */
  properties: {
    id: string;
    slug: string;
    title: string;
    source: BadgeMode;
    rating: { average: number; count: number } | null;
    completedBookings: number;
  }[];
}
