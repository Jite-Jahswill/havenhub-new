import type { Request } from 'express';

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

/** Client IP (honours the configured `trust proxy`) and a bounded user agent. */
export function requestMeta(req: Request): RequestMeta {
  const userAgent = req.get('user-agent');
  return {
    ipAddress: req.ip ?? null,
    userAgent: userAgent ? userAgent.slice(0, 512) : null,
  };
}
