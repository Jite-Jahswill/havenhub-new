import 'server-only';

import type { ApiResponse } from '@havenhub/shared';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';

import { env } from '../env';
import { internalIdentityHeaders } from './client-ip';
import { fetchApiJson } from './fetch-json';
import { requestIdHeaders } from './request-id';

/**
 * Calls the API from Server Components, forwarding the visitor's cookies and
 * (signed) IP, so rate limits and audit records see the visitor rather than
 * this server. Read-only by design: mutations happen in the browser (with
 * CSRF tokens) so the API can enforce its protections end to end.
 */
export function serverApi<T>(path: string): Promise<ApiResponse<T>> {
  return serverApiCached(path) as Promise<ApiResponse<T>>;
}

/**
 * Bounded by a timeout (see fetchApiJson). An abort signal opts a fetch out
 * of Next's per-render de-duplication, so `cache` keeps it: one call per path
 * per render, as before.
 */
const serverApiCached = cache(async (path: string): Promise<ApiResponse<unknown>> => {
  const cookieHeader = (await cookies()).toString();
  const incoming = await headers();
  return fetchApiJson(`${env.API_INTERNAL_URL}/api/v1${path}`, {
    headers: {
      Accept: 'application/json',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...internalIdentityHeaders(incoming),
      ...requestIdHeaders(incoming),
    },
    cache: 'no-store',
  });
});

/** Like `serverApi` but returns the data or `null`. */
export async function serverApiData<T>(path: string): Promise<T | null> {
  const res = await serverApi<T>(path);
  return res.success ? res.data : null;
}
