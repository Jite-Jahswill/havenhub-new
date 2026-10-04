import type { Request } from 'express';

import { clientIp } from './client-ip';

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

/** The canonical client IP (see `resolveClientIp`) and a bounded user agent. */
export function requestMeta(req: Request): RequestMeta {
  const userAgent = req.get('user-agent');
  return {
    ipAddress: clientIp(req) ?? null,
    userAgent: userAgent ? userAgent.slice(0, 512) : null,
  };
}
