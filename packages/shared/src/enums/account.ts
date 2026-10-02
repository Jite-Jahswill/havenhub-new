/**
 * The primary account type decides which HavenHub surface a user belongs to.
 * It is NOT an authorization role: administrator capabilities come from RBAC
 * roles and permissions (see `rbac/`), which the API always resolves itself.
 */
export const AccountType = {
  CUSTOMER: 'CUSTOMER',
  AGENT: 'AGENT',
  ADMIN: 'ADMIN',
} as const;
export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  BLOCKED: 'BLOCKED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
