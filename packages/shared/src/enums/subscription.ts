/**
 * Agent subscriptions (Phase 4). Plans, prices and limits live in the
 * database and are managed by administrators; these are only the vocabulary.
 */
export const BillingInterval = {
  MONTHLY: 'MONTHLY',
  YEARLY: 'YEARLY',
} as const;
export type BillingInterval = (typeof BillingInterval)[keyof typeof BillingInterval];

export const SubscriptionPlanStatus = {
  /** Offered to agents. */
  ACTIVE: 'ACTIVE',
  /** Not offered; existing subscribers keep it until their term ends. */
  INACTIVE: 'INACTIVE',
  /** Retired; kept for history. */
  ARCHIVED: 'ARCHIVED',
} as const;
export type SubscriptionPlanStatus =
  (typeof SubscriptionPlanStatus)[keyof typeof SubscriptionPlanStatus];

/**
 *   PENDING ──(current term ends)──▶ ACTIVE ──(term runs out)──▶ EXPIRED
 *                                      │ ├──(cancel / upgrade)──▶ CANCELLED
 *                                      │ └──(admin)──▶ SUSPENDED ──▶ ACTIVE
 */
export const AgentSubscriptionStatus = {
  /** Paid for; starts when the agent's current term ends. */
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type AgentSubscriptionStatus =
  (typeof AgentSubscriptionStatus)[keyof typeof AgentSubscriptionStatus];

export const SubscriptionChangeType = {
  NEW: 'NEW',
  RENEWAL: 'RENEWAL',
  UPGRADE: 'UPGRADE',
  DOWNGRADE: 'DOWNGRADE',
} as const;
export type SubscriptionChangeType =
  (typeof SubscriptionChangeType)[keyof typeof SubscriptionChangeType];

export const EntitlementKey = {
  PROPERTY_COUNT: 'PROPERTY_COUNT',
  IMAGES_PER_PROPERTY: 'IMAGES_PER_PROPERTY',
  VIDEOS_PER_PROPERTY: 'VIDEOS_PER_PROPERTY',
  FEATURED_PROPERTY_COUNT: 'FEATURED_PROPERTY_COUNT',
  STORAGE_MB: 'STORAGE_MB',
  EVENT_COUNT: 'EVENT_COUNT',
  TOUR_COUNT: 'TOUR_COUNT',
  CLEANING_SERVICE_COUNT: 'CLEANING_SERVICE_COUNT',
  HOTEL_COUNT: 'HOTEL_COUNT',
} as const;
export type EntitlementKey = (typeof EntitlementKey)[keyof typeof EntitlementKey];

export interface EntitlementDefinition {
  key: EntitlementKey;
  label: string;
  /** `account`: across all the agent's listings; `perProperty`: for each listing. */
  scope: 'account' | 'perProperty';
  unit: 'count' | 'MB';
  /**
   * False while the HavenHub feature it limits is not built yet (events,
   * tours, hotels, cleaning services). Plans can already configure it.
   */
  enforced: boolean;
}

/** Display order and meaning of every entitlement. */
export const ENTITLEMENTS: readonly EntitlementDefinition[] = [
  { key: 'PROPERTY_COUNT', label: 'Properties', scope: 'account', unit: 'count', enforced: true },
  {
    key: 'IMAGES_PER_PROPERTY',
    label: 'Images per property',
    scope: 'perProperty',
    unit: 'count',
    enforced: true,
  },
  {
    key: 'VIDEOS_PER_PROPERTY',
    label: 'Videos per property',
    scope: 'perProperty',
    unit: 'count',
    enforced: true,
  },
  {
    key: 'FEATURED_PROPERTY_COUNT',
    label: 'Featured properties',
    scope: 'account',
    unit: 'count',
    enforced: true,
  },
  { key: 'STORAGE_MB', label: 'Image storage', scope: 'account', unit: 'MB', enforced: true },
  { key: 'EVENT_COUNT', label: 'Events', scope: 'account', unit: 'count', enforced: false },
  { key: 'TOUR_COUNT', label: 'Tours', scope: 'account', unit: 'count', enforced: false },
  {
    key: 'CLEANING_SERVICE_COUNT',
    label: 'Cleaning services',
    scope: 'account',
    unit: 'count',
    enforced: false,
  },
  { key: 'HOTEL_COUNT', label: 'Hotel listings', scope: 'account', unit: 'count', enforced: false },
];

export const entitlementDefinition = (key: EntitlementKey): EntitlementDefinition =>
  ENTITLEMENTS.find((e) => e.key === key)!;
