import 'server-only';

import type { ApiResponse, PublicSeoView, PublicSiteView, SeoRoutePath } from '@havenhub/shared';
import type { Metadata } from 'next';
import { cache } from 'react';

import { networkError } from './api/errors';
import { env } from './env';

/** Cache tag of every CMS read; the API asks for it to be revalidated after admin edits. */
export const CMS_TAG = 'cms';

/**
 * Public CMS reads: no cookies (identical for every visitor), cached by the
 * web app and refreshed on demand (`/internal/revalidate`) or within a minute.
 */
export async function cmsApi<T>(path: string): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${env.API_INTERNAL_URL}/api/v1${path}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 60, tags: [CMS_TAG] },
    });
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return networkError;
  }
}

export async function cmsData<T>(path: string): Promise<T | null> {
  const res = await cmsApi<T>(path);
  return res.success ? res.data : null;
}

/** Built-in fallback so the layout renders even when the API is unreachable. */
const FALLBACK_SITE: PublicSiteView = {
  siteName: 'HavenHub',
  tagline: null,
  logo: null,
  faviconUrl: null,
  contact: { email: null, phone: null, address: null },
  socialLinks: [],
  footerText: null,
  features: { blog: false, careers: false, helpCenter: false, newsletter: false },
  newsletter: null,
  pages: [],
  seo: {
    title: null,
    description: null,
    keywords: [],
    ogImageUrl: null,
    twitterHandle: null,
    allowIndexing: true,
  },
  mediaBase: '/api/media',
};

export const getSite = cache(
  async (): Promise<PublicSiteView> => (await cmsData<PublicSiteView>('/site')) ?? FALLBACK_SITE,
);

export const getSeo = cache(async () => cmsData<PublicSeoView>('/seo'));

export const absoluteUrl = (url: string) =>
  url.startsWith('http') ? url : `${env.NEXT_PUBLIC_SITE_URL}${url}`;

/**
 * Metadata for a fixed public route: admin overrides (SEO dashboard) win
 * over the page's own defaults.
 */
export async function routeMetadata(path: SeoRoutePath, fallback: Metadata): Promise<Metadata> {
  const seo = await getSeo();
  const o = seo?.routes[path];
  if (!o) return fallback;
  return {
    ...fallback,
    ...(o.title ? { title: o.title } : {}),
    ...(o.description ? { description: o.description } : {}),
    ...(o.noIndex ? { robots: { index: false, follow: true } } : {}),
    ...(o.ogImageUrl
      ? { openGraph: { ...fallback.openGraph, images: [{ url: absoluteUrl(o.ogImageUrl) }] } }
      : {}),
  };
}
