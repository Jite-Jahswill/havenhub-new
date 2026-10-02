import 'server-only';

import type { ApiResponse } from '@havenhub/shared';
import { cookies } from 'next/headers';

import { env } from '../env';
import { networkError } from './errors';

/**
 * Calls the API from Server Components, forwarding the visitor's cookies.
 * Read-only by design: mutations happen in the browser (with CSRF tokens)
 * so the API can enforce its protections end to end.
 */
export async function serverApi<T>(path: string): Promise<ApiResponse<T>> {
  const cookieHeader = (await cookies()).toString();
  try {
    const res = await fetch(`${env.API_INTERNAL_URL}/api/v1${path}`, {
      headers: { Accept: 'application/json', ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
      cache: 'no-store',
    });
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return networkError;
  }
}

/** Like `serverApi` but returns the data or `null`. */
export async function serverApiData<T>(path: string): Promise<T | null> {
  const res = await serverApi<T>(path);
  return res.success ? res.data : null;
}
