import type { HelpArticleCard } from '@havenhub/shared';
import { Container } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { SupportEntry } from '@/components/cms/support-entry';
import { cmsData, getSite } from '@/lib/cms';

type CategoryPage = {
  category: { slug: string; name: string; description: string | null };
  articles: HelpArticleCard[];
};
const load = cache(async (slug: string) =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    ? cmsData<CategoryPage>(`/help/categories/${slug}`)
    : null,
);

export async function generateMetadata({
  params,
}: PageProps<'/help/category/[slug]'>): Promise<Metadata> {
  const data = await load((await params).slug);
  return data
    ? {
        title: `${data.category.name} · Help centre`,
        description: data.category.description ?? undefined,
      }
    : { title: 'Not found' };
}

export default async function HelpCategoryPage({ params }: PageProps<'/help/category/[slug]'>) {
  const site = await getSite();
  const data = await load((await params).slug);
  if (!site.features.helpCenter || !data) notFound();
  return (
    <Container className="py-8 lg:py-12">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-text-secondary">
        <Link href="/help" className="hover:text-text">
          Help centre
        </Link>
      </nav>
      <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">
        {data.category.name}
      </h1>
      {data.category.description && (
        <p className="mt-2 text-text-secondary">{data.category.description}</p>
      )}
      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ul className="divide-y divide-border self-start rounded-card border border-border bg-surface">
          {data.articles.map((a) => (
            <li key={a.id}>
              <Link href={`/help/${a.slug}`} className="block px-5 py-4 hover:bg-surface-secondary">
                <span className="block font-medium text-text">{a.title}</span>
                {a.summary && (
                  <span className="mt-1 block text-sm text-text-secondary">{a.summary}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
        <aside>
          <SupportEntry email={site.contact.email} />
        </aside>
      </div>
    </Container>
  );
}
