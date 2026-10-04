import 'server-only';

import type { ApiResponse, PublicSeoView, PublicSiteView, SeoRoutePath } from '@havenhub/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { cache } from 'react';

import { internalIdentityHeaders } from './api/client-ip';
import { fetchApiJson } from './api/fetch-json';
import { env } from './env';

/** Cache tag of every CMS read; the API asks for it to be revalidated after admin edits. */
export const CMS_TAG = 'cms';

/**
 * Public CMS reads: no cookies (identical for every visitor), cached by the
 * web app and refreshed on demand (`/internal/revalidate`) or within a minute.
 *
 * `visitor: true` is for reads driven by visitor input (searches): they carry
 * the visitor's signed IP, so the API's per-IP limits apply to that visitor
 * rather than to this server.
 */
export function cmsApi<T>(
  path: string,
  options: { visitor?: boolean } = {},
): Promise<ApiResponse<T>> {
  return cmsApiCached(path, Boolean(options.visitor)) as Promise<ApiResponse<T>>;
}

/** Timeout-bounded; `cache` keeps one call per path per render (see serverApi). */
const cmsApiCached = cache(
  async (path: string, visitor: boolean): Promise<ApiResponse<unknown>> => {
    const identity = visitor ? internalIdentityHeaders(await headers()) : {};
    return fetchApiJson(`${env.API_INTERNAL_URL}/api/v1${path}`, {
      headers: { Accept: 'application/json', ...identity },
      next: { revalidate: 60, tags: [CMS_TAG] },
    });
  },
);

export async function cmsData<T>(
  path: string,
  options: { visitor?: boolean } = {},
): Promise<T | null> {
  const res = await cmsApi<T>(path, options);
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
