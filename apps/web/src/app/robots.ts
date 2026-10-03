import type { MetadataRoute } from 'next';

import { getSeo } from '@/lib/cms';
import { env } from '@/lib/env';

/** Generated from the SEO settings; private areas are always disallowed by the API. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const seo = await getSeo();
  const allow = seo?.robots.allowIndexing ?? true;
  return {
    rules: allow
      ? {
          userAgent: '*',
          allow: '/',
          disallow: seo?.robots.disallow ?? ['/admin', '/agent', '/account', '/api'],
        }
      : { userAgent: '*', disallow: '/' },
    sitemap: allow ? `${env.NEXT_PUBLIC_SITE_URL}/sitemap.xml` : undefined,
  };
}
