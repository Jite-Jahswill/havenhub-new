import type { AccountType, UserStatus } from '../enums/account.js';
import type {
  AgentServiceType,
  AgentVerificationStatus,
  IdDocumentType,
  Sex,
} from '../enums/agent.js';
import type { Permission } from '../rbac/permissions.js';

/**
 * Response shapes returned by the API. These are deliberately explicit
 * allow-lists: sensitive fields (password hashes, NIN, full account numbers)
 * have no place in any of them.
 */

export interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  accountType: AccountType;
  status: UserStatus;
  roles: string[];
  permissions: Permission[];
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface SessionView {
  id: string;
  current: boolean;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
}

export interface AgentProfileView {
  id: string;
  businessName: string | null;
  bio: string | null;
  sex: Sex;
  serviceTypes: AgentServiceType[];
  addressLine: string | null;
  city: string | null;
  lga: string | null;
  state: string | null;
  verificationStatus: AgentVerificationStatus;
  verificationNote: string | null;
  verificationSubmittedAt: string | null;
  verifiedAt: string | null;
  identity: {
    submitted: boolean;
    idDocumentType: IdDocumentType | null;
    /** Only the last 4 digits are ever returned, e.g. "•••••••1234". */
    ninMasked: string | null;
  };
  payoutAccount: PayoutAccountView | null;
  onboardingDismissedAt: string | null;
  createdAt: string;
}

export interface PayoutAccountView {
  bankName: string;
  bankCode: string;
  accountName: string;
  accountNumberMasked: string;
}

/** Safe for anyone, including signed-out visitors. */
export interface AgentPublicView {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  serviceTypes: AgentServiceType[];
  city: string | null;
  state: string | null;
  verified: boolean;
  memberSince: string;
  publishedPropertyCount: number;
}

export interface OnboardingStep {
  key: 'profile' | 'identity' | 'property' | 'payout' | 'plan' | 'customers';
  title: string;
  description: string;
  completed: boolean;
  /** Steps that depend on later platform phases are not yet actionable. */
  available: boolean;
}

export interface AgentOnboardingView {
  steps: OnboardingStep[];
  completedCount: number;
  dismissed: boolean;
}

export interface AgentPlanUsageView {
  planName: string;
  isDefaultPlan: boolean;
  /** `used` is null for per-property allowances. */
  usage: { key: string; label: string; used: number | null; limit: number | null }[];
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AdminUserListItem {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  accountType: AccountType;
  status: UserStatus;
  emailVerified: boolean;
  roles: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminAgentListItem {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  phone: string | null;
  businessName: string | null;
  serviceTypes: AgentServiceType[];
  state: string | null;
  verificationStatus: AgentVerificationStatus;
  verificationSubmittedAt: string | null;
  createdAt: string;
}

export interface AdminAgentDetail extends AdminAgentListItem {
  profile: AgentProfileView;
  userStatus: UserStatus;
  emailVerified: boolean;
}

export interface AdminOverview {
  users: { total: number; customers: number; agents: number; admins: number };
  agentsByVerificationStatus: Record<AgentVerificationStatus, number>;
}

export interface RoleView {
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: Permission[];
}

export interface AuditLogView {
  id: string;
  actor: { id: string; fullName: string; email: string } | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  createdAt: string;
}

export type { IdDocumentType };

export * from './booking.js';
export * from './property.js';
export * from './subscription.js';
export * from './chat.js';
export * from './experience.js';
export * from './cms.js';
