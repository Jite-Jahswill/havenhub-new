import type { AuthUser, Permission } from '@havenhub/shared';

import type { User } from '../../generated/prisma/client';

/**
 * The ONLY way a user leaves the API. An explicit allow-list: the password
 * hash and other internal columns can never leak by accident.
 */
export function toAuthUser(
  user: User,
  access: { roleKeys: string[]; permissions: Iterable<Permission> },
  urlFor: (key: string | null) => string | null,
): AuthUser {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    fullName: user.fullName,
    phone: user.phone,
    avatarUrl: urlFor(user.avatarKey),
    accountType: user.accountType,
    status: user.status,
    roles: access.roleKeys,
    permissions: [...access.permissions].sort(),
    createdAt: user.createdAt.toISOString(),
  };
}
