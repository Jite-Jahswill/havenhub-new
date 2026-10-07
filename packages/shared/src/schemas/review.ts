import { z } from 'zod';

import { paginationQuerySchema } from './admin.js';

/** A customer's review of a completed stay. */
export const createReviewSchema = z
  .object({
    rating: z.number().int().min(1, 'Choose 1 to 5 stars').max(5, 'Choose 1 to 5 stars'),
    comment: z
      .string()
      .trim()
      .max(2000)
      .transform((v) => v || null)
      .nullable()
      .optional(),
  })
  .strict();
export type CreateReviewInput = z.input<typeof createReviewSchema>;

export const hideReviewSchema = z
  .object({ reason: z.string().trim().min(3, 'Say why it is hidden').max(500) })
  .strict();
export type HideReviewInput = z.input<typeof hideReviewSchema>;

export const adminReviewListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['PUBLISHED', 'HIDDEN']).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
});
export type AdminReviewListQuery = z.input<typeof adminReviewListQuerySchema>;

export const propertyReviewsQuerySchema = paginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

/** Stars and how many reviews; null when there are none yet. */
export interface RatingSummary {
  /** One decimal, e.g. 4.7. */
  average: number;
  count: number;
}

export function ratingSummary(sum: number, count: number): RatingSummary | null {
  if (count <= 0) return null;
  return { average: Math.round((sum / count) * 10) / 10, count };
}

/** Public: the author is shown as first name and last initial. */
export interface PublicReviewView {
  id: string;
  rating: number;
  comment: string | null;
  authorName: string;
  createdAt: string;
}

export interface PropertyReviewsPage {
  rating: RatingSummary | null;
  items: PublicReviewView[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AdminReviewView {
  id: string;
  rating: number;
  comment: string | null;
  status: 'PUBLISHED' | 'HIDDEN';
  hiddenReason: string | null;
  property: { id: string; slug: string; title: string };
  customer: { id: string; fullName: string; email: string };
  bookingReference: string;
  createdAt: string;
}

/** On the customer's booking: their review, or whether they can still write one. */
export interface BookingReviewState {
  review: { rating: number; comment: string | null; createdAt: string; hidden: boolean } | null;
  canReview: boolean;
  /** Last moment to review (when `canReview`). */
  reviewBy: string | null;
}

/** "Chiamaka Okafor" → "Chiamaka O." */
export function reviewAuthorName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0] ?? 'Guest';
  const last = parts.length > 1 ? parts[parts.length - 1]! : '';
  return last ? `${first} ${last[0]!.toUpperCase()}.` : first;
}
