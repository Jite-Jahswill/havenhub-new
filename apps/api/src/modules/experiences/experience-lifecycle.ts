import {
  ExperienceStatus as S,
  type ExperienceKind,
  type ExperienceStatus,
  type ModerationAction,
} from '@havenhub/shared';

/**
 * Events, tours, hotels and cleaning services follow the property lifecycle
 * exactly (same statuses, same moderation transitions) — see
 * properties/property-lifecycle.ts. Only what makes a listing complete differs.
 */

export const AGENT_EDITABLE: readonly ExperienceStatus[] = [S.DRAFT, S.REJECTED, S.PUBLISHED];
export const AGENT_SUBMITTABLE: readonly ExperienceStatus[] = [S.DRAFT, S.REJECTED];

export const MODERATION: Record<ModerationAction, { from: readonly ExperienceStatus[] }> = {
  APPROVE: { from: [S.PENDING_REVIEW] },
  REJECT: { from: [S.PENDING_REVIEW] },
  SUSPEND: { from: [S.PUBLISHED, S.PENDING_REVIEW] },
  RESTORE: { from: [S.SUSPENDED] },
};

export function moderationTarget(
  action: ModerationAction,
  listing: { publishedAt: Date | null },
): ExperienceStatus {
  switch (action) {
    case 'APPROVE':
      return S.PUBLISHED;
    case 'REJECT':
      return S.REJECTED;
    case 'SUSPEND':
      return S.SUSPENDED;
    case 'RESTORE':
      return listing.publishedAt ? S.PUBLISHED : S.PENDING_REVIEW;
  }
}

export interface SubmissionFacts {
  kind: ExperienceKind;
  description: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  imageCount: number;
  event: { startsAt: Date | null; endsAt: Date | null } | null;
  tour: { category: string | null } | null;
  hotel: { roomTypeCount: number } | null;
  cleaning: { serviceAreas: string[] } | null;
}

/** What a listing still needs before it can be reviewed. Empty = ready. */
export function missingForSubmission(l: SubmissionFacts, now = new Date()): string[] {
  const missing: string[] = [];
  const need = (ok: unknown, field: string) => {
    if (ok === null || ok === undefined || ok === '') missing.push(field);
  };
  need(l.description, 'description');
  need(l.city, 'city');
  need(l.state, 'state');
  // A cleaning service is described by the areas it covers, not one address.
  if (l.kind === 'CLEANING') {
    if (!l.cleaning?.serviceAreas.length) missing.push('serviceAreas');
  } else {
    need(l.addressLine, 'addressLine');
  }
  if (l.kind === 'EVENT') {
    need(l.event?.startsAt, 'startsAt');
    need(l.event?.endsAt, 'endsAt');
    if (l.event?.startsAt && l.event.startsAt <= now) missing.push('startsAtInFuture');
  }
  if (l.kind === 'TOUR') need(l.tour?.category, 'category');
  if (l.kind === 'HOTEL' && !l.hotel?.roomTypeCount) missing.push('roomTypes');
  if (l.imageCount < 1) missing.push('images');
  return missing;
}
