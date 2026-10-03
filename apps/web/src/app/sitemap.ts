import type { SitemapEntry } from '@havenhub/shared';
import type { MetadataRoute } from 'next';

import { cmsData } from '@/lib/cms';
import { env } from '@/lib/env';

/** Published, indexable public URLs only (decided by the API from SEO settings). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries = (await cmsData<SitemapEntry[]>('/seo/sitemap')) ?? [];
  return entries.map((e) => ({
    url: `${env.NEXT_PUBLIC_SITE_URL}${e.path}`,
    ...(e.lastModified ? { lastModified: e.lastModified } : {}),
  }));
}
