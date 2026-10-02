'use client';

import { AUTH_COOKIES, CSRF_HEADER, ErrorCode, type ApiResponse } from '@havenhub/shared';

import { networkError } from './errors';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

function readCookie(name: string): string | undefined {
  return document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

async function send(method: Method, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const csrf = readCookie(AUTH_COOKIES.CSRF);
  if (method !== 'GET' && csrf) headers[CSRF_HEADER] = decodeURIComponent(csrf);

  return fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let refreshing: Promise<boolean> | null = null;

/** One shared refresh for all concurrent callers. */
function refreshSession(): Promise<boolean> {
  refreshing ??= send('POST', '/auth/refresh')
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * Browser client for the HavenHub API. Authentication rides on HttpOnly
 * cookies the script cannot read; the CSRF token is echoed in a header.
 * An expired access token is refreshed once, transparently.
 */
export async function api<T>(
  method: Method,
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  try {
    let res = await send(method, path, body);
    if (res.status === 401 && !path.startsWith('/auth/')) {
      const payload = (await res.clone().json()) as ApiResponse<T>;
      if (
        !payload.success &&
        payload.code === ErrorCode.SESSION_EXPIRED &&
        (await refreshSession())
      ) {
        res = await send(method, path, body);
      }
    }
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return networkError;
  }
}

/** Multipart upload of a single file in the `file` field (images). */
export async function apiUpload<T>(path: string, file: File): Promise<ApiResponse<T>> {
  const body = new FormData();
  body.append('file', file);
  const headers: Record<string, string> = { Accept: 'application/json' };
  const csrf = readCookie(AUTH_COOKIES.CSRF);
  if (csrf) headers[CSRF_HEADER] = decodeURIComponent(csrf);
  try {
    let res = await fetch(`/api/v1${path}`, {
      method: 'POST',
      headers,
      body,
      credentials: 'same-origin',
    });
    if (res.status === 401 && (await refreshSession())) {
      res = await fetch(`/api/v1${path}`, {
        method: 'POST',
        headers,
        body,
        credentials: 'same-origin',
      });
    }
    if (res.status === 413) {
      return { success: false, code: 'INVALID_FILE', message: 'Images must be 10 MB or smaller.' };
    }
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return networkError;
  }
}
