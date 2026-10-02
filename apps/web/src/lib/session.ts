import 'server-only';

import { AccountType, type AuthUser, type Permission } from '@havenhub/shared';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import { serverApiData } from './api/server';
import { DASHBOARD_PATH } from './navigation';

/** The signed-in user for this request, or `null`. Deduplicated per request. */
export const getCurrentUser = cache(() => serverApiData<AuthUser>('/auth/me'));

/**
 * Page-level guard for dashboards. This only shapes navigation — every API
 * call made by these pages is authorised again by the backend.
 */
export async function requireUser(accountType: AccountType, path: string): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);
  if (user.accountType !== accountType) redirect(DASHBOARD_PATH[user.accountType]);
  return user;
}

export const hasPermission = (user: AuthUser, permission: Permission) =>
  user.accountType === AccountType.ADMIN && user.permissions.includes(permission);
