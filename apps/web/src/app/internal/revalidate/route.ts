import { createHash, timingSafeEqual } from 'node:crypto';

import { revalidateTag } from 'next/cache';

import { CMS_TAG } from '@/lib/cms';
import { env } from '@/lib/env';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Server-to-server: the API calls this after a CMS change so cached pages
 * refresh on the next visit. Authenticated by REVALIDATE_SECRET (never sent
 * to browsers); disabled when the secret is not configured.
 */
export function POST(request: Request) {
  const secret = env.REVALIDATE_SECRET;
  const given = request.headers.get('x-revalidate-secret') ?? '';
  if (!secret || !timingSafeEqual(digest(given), digest(secret))) {
    return Response.json({ success: false }, { status: 401 });
  }
  revalidateTag(CMS_TAG, { expire: 0 });
  return Response.json({ success: true, data: { revalidated: true } });
}
