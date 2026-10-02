import { AUTH_COOKIES, CSRF_HEADER } from '@havenhub/shared';
import { NextResponse, type NextRequest } from 'next/server';

const API_URL = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/**
 * Keeps web sessions alive across page loads. Access tokens are short-lived;
 * when one has expired (its cookie is gone) but a refresh cookie remains,
 * rotate the session before rendering, and pass the new cookies both to the
 * browser and to this request so Server Components see the fresh session.
 */
export async function proxy(request: NextRequest) {
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

export const config = {
  // Pages only — not API calls, static assets or images.
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)',
  ],
};
