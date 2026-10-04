import { isIP } from 'node:net';

/** Headers the API honours only together with INTERNAL_API_SECRET (see the API's client-ip.ts). */
export const INTERNAL_SECRET_HEADER = 'x-havenhub-internal';
export const CLIENT_IP_HEADER = 'x-havenhub-client-ip';

/**
 * The visitor's IP as reported by the hosting platform. Only Vercel's edge
 * is trusted: it sets X-Real-IP / X-Forwarded-For itself, so a visitor
 * cannot forge them. Anywhere else (local development) there is no trusted
 * source and the API falls back to the connection's own address.
 */
export function visitorIp(headers: Headers): string | null {
  if (process.env.VERCEL !== '1') return null;
  const candidate =
    headers.get('x-real-ip')?.trim() || headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (!candidate || candidate.length > 45 || candidate.includes('%') || !isIP(candidate)) {
    return null;
  }
  return candidate.toLowerCase();
}

/**
 * Identity headers for a server-to-server API call on behalf of a visitor,
 * or none when there is no secret or no trusted visitor IP. The secret is
 * server-only and is never sent to browsers.
 */
export function internalIdentityHeaders(incoming: Headers): Record<string, string> {
  const secret = process.env.INTERNAL_API_SECRET;
  const ip = visitorIp(incoming);
  if (!secret || !ip) return {};
  return { [INTERNAL_SECRET_HEADER]: secret, [CLIENT_IP_HEADER]: ip };
}
