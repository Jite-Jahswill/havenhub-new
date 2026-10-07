import type { ModeratedListingType, SmtpSecurity, SmtpSource } from '../enums/platform.js';
import type { Permission } from '../rbac/permissions.js';
import type { PublicPlatformPolicies } from '../schemas/platform-policies.js';

// ── RBAC ──

export interface RoleDetail {
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: Permission[];
  userCount: number;
  users: { id: string; fullName: string; email: string }[];
  updatedAt: string;
}

// ── Audit log ──

export interface AuditLogDetail {
  id: string;
  actor: { id: string; fullName: string; email: string } | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

// ── Analytics ──

/** A figure, or "not available" when the feature it measures does not exist yet. */
export type Metric = { available: true; value: number } | { available: false; reason: string };

export interface AnalyticsRange {
  /** Inclusive calendar dates in Nigerian time (WAT). */
  from: string;
  to: string;
}

export interface PlatformAnalytics {
  range: AnalyticsRange;
  users: { total: Metric; new: Metric; active: Metric };
  agents: { total: Metric; verified: Metric };
  /** Listings live on the public site right now (status history is not stored). */
  listings: Record<ModeratedListingType, Metric>;
  bookings: { confirmed: Metric };
  sales: Metric;
  eventTicketSales: Metric;
  reviews: Metric;
}

/** All money in integer kobo. */
export interface FinancialAnalytics {
  range: AnalyticsRange;
  /** Gross value of successful booking payments, by payment date, before refunds. */
  revenueKobo: Metric;
  successfulPayments: Metric;
  /** Completed refunds, by completion date. */
  refundsKobo: Metric;
  refunds: Metric;
  commissionKobo: Metric;
  serviceFeeKobo: Metric;
  vatKobo: Metric;
  /** Successful subscription payments, by payment date. */
  subscriptionRevenueKobo: Metric;
  withdrawalsKobo: Metric;
  eventTicketSalesKobo: Metric;
}

export interface AgentAnalytics {
  range: AnalyticsRange;
  propertyViews: Metric;
  bookings: Metric;
  /** Bookings ÷ property views (0–1); not available when there were no views. */
  conversion: Metric;
  revenueKobo: Metric;
  earningsKobo: Metric;
  reviews: Metric;
  eventSalesKobo: Metric;
}

// ── SMTP ──

/** The password is never returned — only whether one is stored. */
export interface SmtpSettingsView {
  source: SmtpSource;
  database: {
    host: string;
    port: number;
    security: SmtpSecurity;
    username: string | null;
    passwordSet: boolean;
    fromEmail: string;
    fromName: string;
    updatedAt: string;
    updatedBy: { id: string; fullName: string } | null;
  } | null;
  environment: { host: string } | null;
}

export interface SmtpTestResult {
  delivered: boolean;
  /** Sent to the signed-in administrator's own address. */
  to: string;
  /** A generic reason when it failed; server responses are never echoed. */
  error: string | null;
}

// ── Platform ──

export interface PlatformSettingsView {
  maintenance: {
    enabled: boolean;
    message: string | null;
    returnText: string | null;
    updatedAt: string;
  };
  /** `true` = admin review is required before publication. */
  moderation: Record<ModeratedListingType, boolean>;
}

/** Public: what the web app needs to render (or skip) the maintenance page. */
export interface PlatformStatusView {
  maintenance: {
    enabled: boolean;
    message: string | null;
    returnText: string | null;
    retryAfterSeconds: number;
  };
  site: {
    name: string;
    logo: { url: string; width: number; height: number } | null;
    contactEmail: string | null;
    contactPhone: string | null;
    contactAddress: string | null;
  };
  /** Admin policies the public site follows (password length, enabled features). */
  policies: PublicPlatformPolicies;
}
