import type { Currency } from '../enums/property.js';
import type { PaymentProviderName, PaymentStatus } from '../enums/booking.js';
import type {
  AgentSubscriptionStatus,
  BillingInterval,
  EntitlementKey,
  SubscriptionChangeType,
  SubscriptionPlanStatus,
} from '../enums/subscription.js';

/** All money values are integer kobo; all limits: 0 = not included, null = unlimited. */

export type PlanEntitlements = Record<EntitlementKey, number | null>;

export interface SubscriptionPlanView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: SubscriptionPlanStatus;
  isDefault: boolean;
  priceKobo: number;
  currency: Currency;
  /** Null only for the free default plan. */
  billingInterval: BillingInterval | null;
  rank: number;
  features: string[];
  entitlements: PlanEntitlements;
}

export interface AdminSubscriptionPlanView extends SubscriptionPlanView {
  activeSubscribers: number;
  /** Terms ever bought on this plan (any status). */
  totalSubscriptions: number;
  /** Only plans nobody has ever paid for can be deleted; others are archived. */
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UsageItem {
  key: EntitlementKey;
  label: string;
  scope: 'account' | 'perProperty';
  unit: 'count' | 'MB';
  /**
   * Account-wide usage, or for per-property allowances the fullest listing.
   * Null where HavenHub has nothing to count yet (feature not built).
   */
  used: number | null;
  limit: number | null;
  /** False for allowances whose feature is not built yet. */
  enforced: boolean;
}

export interface AgentSubscriptionView {
  id: string;
  plan: { id: string; name: string; slug: string };
  status: AgentSubscriptionStatus;
  changeType: SubscriptionChangeType;
  priceKobo: number;
  currency: Currency;
  billingInterval: BillingInterval;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  startedAt: string | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  createdAt: string;
}

export interface CurrentSubscriptionView {
  /** The plan whose limits apply right now (the free default without a paid term). */
  plan: SubscriptionPlanView;
  /** The active paid term, if any. */
  subscription: AgentSubscriptionView | null;
  /** A paid term waiting to start after the current one. */
  scheduled: AgentSubscriptionView | null;
  usage: UsageItem[];
  /** Allowances the agent currently exceeds (e.g. after a downgrade). Nothing is removed. */
  overLimit: EntitlementKey[];
}

export interface SubscriptionQuoteView {
  plan: SubscriptionPlanView;
  changeType: SubscriptionChangeType;
  amountKobo: number;
  /** True when the plan applies as soon as payment is verified. */
  startsImmediately: boolean;
  startsAt: string;
  endsAt: string;
  /** Plain statements of how this change is billed — shown before payment. */
  notes: string[];
  /** Where current usage exceeds the target plan (downgrades). */
  overLimit: { key: EntitlementKey; label: string; used: number; limit: number }[];
}

export interface SubscriptionCheckoutView {
  reference: string;
  provider: PaymentProviderName;
  authorizationUrl: string;
  amountKobo: number;
  quote: SubscriptionQuoteView;
}

export interface SubscriptionPaymentView {
  id: string;
  reference: string;
  planId: string;
  planName: string;
  amountKobo: number;
  currency: Currency;
  billingInterval: BillingInterval;
  provider: PaymentProviderName;
  status: PaymentStatus;
  failureReason: string | null;
  subscriptionId: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface SubscriptionPaymentVerificationView {
  reference: string;
  paymentStatus: PaymentStatus;
  subscription: AgentSubscriptionView | null;
}

export interface SubscriptionTestCheckoutView {
  reference: string;
  amountKobo: number;
  planName: string;
  billingInterval: BillingInterval;
  status: PaymentStatus;
}

export interface AdminSubscriptionListItem extends AgentSubscriptionView {
  agent: { id: string; userId: string; displayName: string; email: string };
}

export interface AdminSubscriptionDetail extends AdminSubscriptionListItem {
  payments: SubscriptionPaymentView[];
  suspendedAt: string | null;
}

/** Every figure is counted from stored records; nothing is estimated. */
export interface SubscriptionStatsView {
  agents: number;
  paidAgents: number;
  freeAgents: number;
  byStatus: Record<AgentSubscriptionStatus, number>;
  revenueKobo: number;
  revenueLast30DaysKobo: number;
  last30Days: { new: number; renewals: number; upgrades: number; downgrades: number };
  byPlan: {
    planId: string;
    name: string;
    isDefault: boolean;
    activeSubscribers: number;
    revenueKobo: number;
  }[];
}
