import type { FaqView, HelpArticleCard, HelpCategoryView } from '@havenhub/shared';
import { Button, Container, Input } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { FaqList } from '@/components/cms/faq-list';
import { JsonLd } from '@/components/cms/json-ld';
import { SupportEntry } from '@/components/cms/support-entry';
import { cmsData, getSite, routeMetadata } from '@/lib/cms';
import { env } from '@/lib/env';

export function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/help', {
    title: 'Help centre',
    description: 'Answers about renting, booking, payments and listing on HavenHub.',
    alternates: { canonical: `${env.NEXT_PUBLIC_SITE_URL}/help` },
  });
}

export default async function HelpPage({ searchParams }: PageProps<'/help'>) {
  const site = await getSite();
  if (!site.features.helpCenter) notFound();
  const raw = (await searchParams).q;
  const q = typeof raw === 'string' ? raw.trim().slice(0, 100) : '';
  const [categories, faqs, results] = await Promise.all([
    cmsData<HelpCategoryView[]>('/help/categories'),
    cmsData<FaqView[]>('/help/faqs'),
    q
      ? cmsData<{ articles: HelpArticleCard[]; faqs: FaqView[] }>(
          `/help/search?q=${encodeURIComponent(q)}`,
        )
      : null,
  ]);
  return (
    <Container className="py-8 lg:py-12">
      {faqs && faqs.length > 0 && !q && (
        <JsonLd
          data={{
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: faqs.map((f) => ({
              '@type': 'Question',
              name: f.question,
              acceptedAnswer: { '@type': 'Answer', text: f.answer },
            })),
          }}
        />
      )}
      <header className="mb-8 max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">Help centre</h1>
        <p className="mt-2 text-text-secondary">Find answers, or contact our support team.</p>
        <form role="search" action="/help" className="mt-6 flex max-w-lg gap-2">
          <Input
            name="q"
            defaultValue={q}
            maxLength={100}
            placeholder="Search help articles"
            aria-label="Search help articles"
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-10">
          {q ? (
            <section aria-labelledby="results">
              <h2 id="results" className="mb-4 text-lg font-semibold text-text">
                Results for “{q}”
              </h2>
              {!results || (results.articles.length === 0 && results.faqs.length === 0) ? (
                <p className="text-text-secondary">
                  Nothing matched. Try other words, or{' '}
                  <Link href="/help" className="font-medium text-primary-text underline">
                    browse all topics
                  </Link>
                  .
                </p>
              ) : (
                <div className="flex flex-col gap-6">
                  <ArticleList articles={results.articles} />
                  {results.faqs.length > 0 && (
                    <FaqList faqs={results.faqs} mediaBase={site.mediaBase} />
                  )}
                </div>
              )}
            </section>
          ) : (
            <>
              {categories && categories.length > 0 && (
                <section aria-labelledby="topics">
                  <h2 id="topics" className="mb-4 text-lg font-semibold text-text">
                    Topics
                  </h2>
                  <ul className="grid gap-4 sm:grid-cols-2">
                    {categories.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/help/category/${c.slug}`}
                          className="flex h-full flex-col gap-1 rounded-card border border-border bg-surface p-5 shadow-card hover:bg-surface-secondary"
                        >
                          <span className="font-semibold text-text">{c.name}</span>
                          {c.description && (
                            <span className="text-sm text-text-secondary">{c.description}</span>
                          )}
                          <span className="mt-1 text-xs text-text-muted">
                            {c.articleCount} {c.articleCount === 1 ? 'article' : 'articles'}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {faqs && faqs.length > 0 && (
                <section aria-labelledby="faqs">
                  <h2 id="faqs" className="mb-4 text-lg font-semibold text-text">
                    Frequently asked questions
                  </h2>
                  <FaqList faqs={faqs} mediaBase={site.mediaBase} />
                </section>
              )}
              {!categories?.length && !faqs?.length && (
                <p className="text-text-secondary">Help articles are on their way.</p>
              )}
            </>
          )}
        </div>
        <aside>
          <SupportEntry email={site.contact.email} />
        </aside>
      </div>
    </Container>
  );
}

function ArticleList({ articles }: { articles: HelpArticleCard[] }) {
  if (!articles.length) return null;
  return (
    <ul className="divide-y divide-border rounded-card border border-border bg-surface">
      {articles.map((a) => (
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
  );
}
