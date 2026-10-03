import type { PublicPageView } from '@havenhub/shared';
import { Container } from '@havenhub/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { cache } from 'react';

import { absoluteUrl, cmsData, getSite } from '@/lib/cms';
import { env } from '@/lib/env';
import { formatDate } from '@/lib/format';

import { Markdown } from './markdown';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A published CMS page, or null (drafts and archived pages are never public). */
export const getPage = cache(async (slug: string) =>
  SLUG.test(slug) ? cmsData<PublicPageView>(`/pages/${slug}`) : null,
);

export async function pageMetadata(slug: string, path: string): Promise<Metadata> {
  const page = await getPage(slug);
  if (!page) return { title: 'Page not found', robots: { index: false } };
  return {
    title: page.seoTitle ?? page.title,
    description: page.seoDescription ?? undefined,
    alternates: { canonical: `${env.NEXT_PUBLIC_SITE_URL}${path}` },
    ...(page.noIndex ? { robots: { index: false, follow: true } } : {}),
    ...(page.ogImage ? { openGraph: { images: [{ url: absoluteUrl(page.ogImage.url) }] } } : {}),
  };
}

export async function CmsPage({ slug, aside }: { slug: string; aside?: ReactNode }) {
  const [page, site] = await Promise.all([getPage(slug), getSite()]);
  if (!page) notFound();
  return (
    <Container className="py-8 lg:py-12">
      <div
        className={aside ? 'grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]' : 'mx-auto max-w-3xl'}
      >
        <article className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight break-words text-text sm:text-4xl">
            {page.title}
          </h1>
          <p className="mt-2 text-sm text-text-muted">Last updated {formatDate(page.updatedAt)}</p>
          <Markdown source={page.body} mediaBase={site.mediaBase} className="mt-8" />
        </article>
        {aside && <aside>{aside}</aside>}
      </div>
    </Container>
  );
}
