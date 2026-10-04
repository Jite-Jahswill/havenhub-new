import { isIP } from 'node:net';

import type { NextFunction, Request, Response } from 'express';

import { safeEqual } from '../../infrastructure/crypto/tokens';

/** Sent by the HavenHub web server only: the shared secret, and the visitor's IP. */
export const INTERNAL_SECRET_HEADER = 'x-havenhub-internal';
export const CLIENT_IP_HEADER = 'x-havenhub-client-ip';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The canonical visitor IP (see `resolveClientIp`). */
      clientIp?: string;
    }
  }
}

/** A single, plain IPv4/IPv6 address (no lists, ports, spaces or zone ids), lower-cased. */
export function parseClientIp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 45) return null;
  if (value.includes('%') || isIP(value) === 0) return null;
  return value.toLowerCase();
}

/**
 * The visitor's IP, used for every rate limit and every audit/session record.
 *
 *  - The web server (SSR, its session refresh and the /api rewrite) proves
 *    itself with INTERNAL_API_SECRET and names the visitor in
 *    X-HavenHub-Client-IP. That header is honoured only with a valid secret
 *    (constant-time comparison) and a single valid IP address.
 *  - Everything else — direct API calls, Socket.IO, or the web server
 *    without a visitor IP — uses Express's `req.ip`, which applies
 *    TRUST_PROXY (1 = the Railway edge). Client-supplied X-Forwarded-For or
 *    X-Real-IP values are therefore never taken at face value.
 */
export function resolveClientIp(req: Request, secret: string | undefined): string | undefined {
  const fallback = req.ip;
  if (!secret) return fallback;
  const presented = req.headers[INTERNAL_SECRET_HEADER];
  if (typeof presented !== 'string' || !safeEqual(presented, secret)) return fallback;
  return parseClientIp(req.headers[CLIENT_IP_HEADER]) ?? fallback;
}

/** Resolves the canonical IP once, before guards run. */
export function clientIpMiddleware(secret: string | undefined) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.clientIp = resolveClientIp(req, secret);
    next();
  };
}

/** The canonical visitor IP of a request (undefined only if the socket has none). */
export const clientIp = (req: Request): string | undefined => req.clientIp ?? req.ip;
