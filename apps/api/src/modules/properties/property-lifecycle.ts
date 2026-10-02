import {
  AgentVerificationStatus,
  NON_RESIDENTIAL_TYPES,
  PropertyStatus as S,
  type ModerationAction,
  type PropertyStatus,
} from '@havenhub/shared';

import type { Property } from '../../generated/prisma/client';

/** Statuses in which the owning agent may change content or media. */
export const AGENT_EDITABLE: readonly PropertyStatus[] = [S.DRAFT, S.REJECTED, S.PUBLISHED];

/** Statuses from which the agent may submit for review. */
export const AGENT_SUBMITTABLE: readonly PropertyStatus[] = [S.DRAFT, S.REJECTED];

/** Agents whose accounts are restricted can view but not change their listings. */
export const RESTRICTED_AGENT_STATUSES: readonly string[] = [
  AgentVerificationStatus.SUSPENDED,
  AgentVerificationStatus.BLOCKED,
];

/** Admin moderation: which statuses each action may start from, and where it leads. */
export const MODERATION: Record<ModerationAction, { from: readonly PropertyStatus[] }> = {
  APPROVE: { from: [S.PENDING_REVIEW] },
  REJECT: { from: [S.PENDING_REVIEW] },
  SUSPEND: { from: [S.PUBLISHED, S.PENDING_REVIEW] },
  RESTORE: { from: [S.SUSPENDED] },
};

export function moderationTarget(
  action: ModerationAction,
  property: Pick<Property, 'publishedAt'>,
): PropertyStatus {
  switch (action) {
    case 'APPROVE':
      return S.PUBLISHED;
    case 'REJECT':
      return S.REJECTED;
    case 'SUSPEND':
      return S.SUSPENDED;
    case 'RESTORE':
      // A listing that was live goes straight back; otherwise it needs review.
      return property.publishedAt ? S.PUBLISHED : S.PENDING_REVIEW;
  }
}

type SubmissionFields = Pick<
  Property,
  | 'description'
  | 'pricingPeriod'
  | 'addressLine'
  | 'city'
  | 'lga'
  | 'state'
  | 'latitude'
  | 'longitude'
  | 'priceKobo'
  | 'propertyType'
  | 'listingType'
  | 'bedrooms'
  | 'bathrooms'
  | 'maxGuests'
  | 'cleaningOption'
>;

/** What a property still needs before it can be reviewed. Empty = ready. */
export function missingForSubmission(p: SubmissionFields, imageCount: number): string[] {
  const missing: string[] = [];
  const need = (ok: unknown, field: string) => {
    if (ok === null || ok === undefined || ok === '') missing.push(field);
  };
  need(p.description, 'description');
  need(p.pricingPeriod, 'pricingPeriod');
  need(p.priceKobo, 'priceKobo');
  need(p.addressLine, 'addressLine');
  need(p.city, 'city');
  need(p.lga, 'lga');
  need(p.state, 'state');
  if (p.latitude === null || p.longitude === null) missing.push('location');

  const residential = !NON_RESIDENTIAL_TYPES.includes(p.propertyType);
  if (residential) {
    need(p.bedrooms, 'bedrooms');
    need(p.bathrooms, 'bathrooms');
  }
  if (p.listingType === 'RENT') need(p.cleaningOption, 'cleaningOption');
  if (p.pricingPeriod === 'DAILY') need(p.maxGuests, 'maxGuests');
  if (imageCount < 1) missing.push('images');
  return missing;
}
