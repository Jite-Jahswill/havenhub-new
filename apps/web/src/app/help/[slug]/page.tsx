import type { HelpArticleDetail } from '@havenhub/shared';
import { Container } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { Markdown } from '@/components/cms/markdown';
import { SupportEntry } from '@/components/cms/support-entry';
import { cmsData, getSite } from '@/lib/cms';
import { env } from '@/lib/env';
import { formatDate } from '@/lib/format';

const getArticle = cache(async (slug: string) =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    ? cmsData<HelpArticleDetail>(`/help/articles/${slug}`)
    : null,
);

export async function generateMetadata({ params }: PageProps<'/help/[slug]'>): Promise<Metadata> {
  const a = await getArticle((await params).slug);
  if (!a) return { title: 'Article not found', robots: { index: false } };
  return {
    title: a.seoTitle ?? a.title,
    description: a.seoDescription ?? a.summary ?? undefined,
    alternates: { canonical: `${env.NEXT_PUBLIC_SITE_URL}/help/${a.slug}` },
  };
}

export default async function HelpArticlePage({ params }: PageProps<'/help/[slug]'>) {
  const site = await getSite();
  const article = await getArticle((await params).slug);
  if (!site.features.helpCenter || !article) notFound();
  return (
    <Container className="py-8 lg:py-12">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-text-secondary">
        <Link href="/help" className="hover:text-text">
          Help centre
        </Link>{' '}
        /{' '}
        <Link href={`/help/category/${article.category.slug}`} className="hover:text-text">
          {article.category.name}
        </Link>
      </nav>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <article className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight break-words text-text sm:text-3xl">
            {article.title}
          </h1>
          <p className="mt-2 text-sm text-text-muted">Updated {formatDate(article.updatedAt)}</p>
          <Markdown source={article.body} mediaBase={site.mediaBase} className="mt-6" />
        </article>
        <aside>
          <SupportEntry email={site.contact.email} />
        </aside>
      </div>
    </Container>
  );
}
