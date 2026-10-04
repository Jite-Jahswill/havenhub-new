import type { ApiResponse } from '@havenhub/shared';

import { networkError } from './errors';

/**
 * Upper bound for one server-side API call. Generous enough for the slowest
 * legitimate reads (admin analytics), short enough that a hung API cannot
 * hold a page render (and its server worker) indefinitely.
 */
export const SERVER_API_TIMEOUT_MS = 15_000;

/**
 * Fetches a HavenHub API envelope from the server. A timeout, an unreachable
 * API or a response that is not an API envelope (e.g. a proxy's HTML error
 * page) all become the existing `networkError`; API errors pass through
 * unchanged. Nothing from a failed response is surfaced to the page.
 */
export async function fetchApiJson<T>(
  url: string,
  init: RequestInit & { next?: { revalidate?: number; tags?: string[] } },
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<ApiResponse<T>> {
  const { timeoutMs = SERVER_API_TIMEOUT_MS, fetchImpl = fetch } = options;
  try {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const body = (await res.json()) as unknown;
    if (
      typeof body !== 'object' ||
      body === null ||
      typeof (body as { success?: unknown }).success !== 'boolean'
    ) {
      return networkError;
    }
    return body as ApiResponse<T>;
  } catch {
    return networkError;
  }
}
