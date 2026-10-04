import {
  AUTH_COOKIES,
  CSRF_HEADER,
  type ApiResponse,
  type PlatformStatusView,
} from '@havenhub/shared';
import { NextResponse, type NextRequest } from 'next/server';

import {
  CLIENT_IP_HEADER,
  INTERNAL_SECRET_HEADER,
  internalIdentityHeaders,
} from './lib/api/client-ip';
import { requestIdHeaders } from './lib/api/request-id';
import { maintenancePage } from './lib/maintenance-page';

const API_URL = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/**
 * Pages that stay available in maintenance mode: the admin panel, sign-in
 * and account recovery, the system status page and on-demand revalidation.
 * (The API applies the same rule on its side and is the real authority.)
 */
const MAINTENANCE_OPEN = [
  '/admin',
  '/login',
  '/register',
  '/check-email',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/status',
  '/internal',
];

const isOpen = (path: string) =>
  MAINTENANCE_OPEN.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

/** Reads the switch from the API on every page request (no client input, no stale cache). */
async function maintenanceResponse(request: NextRequest): Promise<NextResponse | null> {
  if (isOpen(request.nextUrl.pathname)) return null;
  let status: PlatformStatusView;
  try {
    const res = await fetch(`${API_URL}/api/v1/platform/status`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    const body = (await res.json()) as ApiResponse<PlatformStatusView>;
    if (!body.success) return null;
    status = body.data;
  } catch {
    // API unreachable: pages fail on their own; do not guess.
    return null;
  }
  if (!status.maintenance.enabled) return null;
  return new NextResponse(maintenancePage(status), {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Retry-After': String(status.maintenance.retryAfterSeconds),
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Maintenance mode first (503 page for public routes), then session upkeep.
 *
 * Keeps web sessions alive across page loads. Access tokens are short-lived;
 * when one has expired (its cookie is gone) but a refresh cookie remains,
 * rotate the session before rendering, and pass the new cookies both to the
 * browser and to this request so Server Components see the fresh session.
 */
export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) return forwardApi(request);

  const blocked = await maintenanceResponse(request);
  if (blocked) return blocked;

  const hasAccess = request.cookies.has(AUTH_COOKIES.ACCESS);
  const refresh = request.cookies.get(AUTH_COOKIES.REFRESH)?.value;
  if (hasAccess || !refresh) return NextResponse.next();

  let setCookies: string[];
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        Cookie: request.headers.get('cookie') ?? '',
        Origin: request.nextUrl.origin,
        [CSRF_HEADER]: request.cookies.get(AUTH_COOKIES.CSRF)?.value ?? '',
        'User-Agent': request.headers.get('user-agent') ?? '',
        'X-Forwarded-For': request.headers.get('x-forwarded-for') ?? '',
        ...internalIdentityHeaders(request.headers),
        ...requestIdHeaders(request.headers),
      },
      cache: 'no-store',
    });
    setCookies = res.headers.getSetCookie();
  } catch {
    return NextResponse.next();
  }

  // Apply the API's Set-Cookie headers (new tokens, or clearing on failure).
  const requestCookies = new Map(request.cookies.getAll().map((c) => [c.name, c.value]));
  for (const line of setCookies) {
    const [pair] = line.split(';');
    const eq = pair!.indexOf('=');
    const name = pair!.slice(0, eq);
    const value = pair!.slice(eq + 1);
    if (value) requestCookies.set(name, value);
    else requestCookies.delete(name);
  }
  const headers = new Headers(request.headers);
  headers.set('cookie', [...requestCookies].map(([name, value]) => `${name}=${value}`).join('; '));

  const response = NextResponse.next({ request: { headers } });
  for (const line of setCookies) response.headers.append('set-cookie', line);
  return response;
}

/**
 * Browser calls to `/api/*` are rewritten to the API (next.config.ts). Before
 * that, drop any identity headers the browser sent and attach the visitor's
 * signed IP, so the API rate-limits and audits the visitor, not this server.
 */
function forwardApi(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_SECRET_HEADER);
  headers.delete(CLIENT_IP_HEADER);
  for (const [name, value] of Object.entries({
    ...internalIdentityHeaders(request.headers),
    ...requestIdHeaders(request.headers),
  })) {
    headers.set(name, value);
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages (maintenance, session upkeep) and API calls (visitor identity) —
  // not static assets or images.
  matcher: [
    '/api/:path*',
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)',
  ],
};
