import type { BlogCategoryView, BlogPostList } from '@havenhub/shared';
import { Alert, Button, Container, Input, buttonClasses } from '@havenhub/ui';
import { Newspaper } from 'lucide-react';
import Link from 'next/link';

import { BlogCard } from './blog-card';

/** Shared by /blog, category and tag pages. Filters live in the URL. */
export function BlogList({
  heading,
  intro,
  result,
  categories,
  basePath,
  q,
  active,
}: {
  heading: string;
  intro?: string | null;
  result: BlogPostList | null;
  categories: BlogCategoryView[];
  basePath: string;
  q?: string;
  active?: string;
}) {
  const pageHref = (page: number) => {
    const params = new URLSearchParams({ ...(q ? { q } : {}), page: String(page) });
    return `${basePath}?${params}`;
  };
  return (
    <Container className="py-8 lg:py-12">
      <header className="mb-8 max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">{heading}</h1>
        {intro && <p className="mt-2 text-text-secondary">{intro}</p>}
      </header>
      <div className="mb-8 flex flex-col gap-4">
        <form role="search" action="/blog" className="flex max-w-lg gap-2">
          <Input
            name="q"
            defaultValue={q}
            maxLength={100}
            placeholder="Search articles"
            aria-label="Search articles"
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        {categories.length > 0 && (
          <nav aria-label="Categories" className="flex flex-wrap gap-2 text-sm">
            <Link
              href="/blog"
              aria-current={!active ? 'page' : undefined}
              className="rounded-full border border-border px-3.5 py-1.5 font-medium text-text hover:bg-surface-secondary aria-[current=page]:bg-surface-inverse aria-[current=page]:text-text-inverse"
            >
              All
            </Link>
            {categories.map((c) => (
              <Link
                key={c.id}
                href={`/blog/category/${c.slug}`}
                aria-current={active === c.slug ? 'page' : undefined}
                className="rounded-full border border-border px-3.5 py-1.5 font-medium text-text hover:bg-surface-secondary aria-[current=page]:bg-surface-inverse aria-[current=page]:text-text-inverse"
              >
                {c.name}
              </Link>
            ))}
          </nav>
        )}
      </div>
      {!result ? (
        <Alert tone="error">The blog could not be loaded. Please try again.</Alert>
      ) : result.items.length === 0 ? (
        <div className="flex flex-col items-center rounded-card border border-dashed border-border px-6 py-20 text-center">
          <Newspaper aria-hidden className="size-8 text-text-muted" strokeWidth={1.5} />
          <h2 className="mt-4 font-semibold text-text">
            {q ? 'No articles match your search' : 'No articles yet'}
          </h2>
          {q && (
            <Link
              href="/blog"
              className={buttonClasses({ variant: 'secondary', className: 'mt-6' })}
            >
              Clear search
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {result.items.map((p, i) => (
              <BlogCard key={p.id} post={p} priority={i < 3} />
            ))}
          </div>
          {result.totalPages > 1 && (
            <nav
              aria-label="Pagination"
              className="mt-12 flex items-center justify-center gap-3 text-sm"
            >
              {result.page > 1 && (
                <Link
                  href={pageHref(result.page - 1)}
                  className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                >
                  Previous
                </Link>
              )}
              <span className="text-text-secondary">
                Page {result.page} of {result.totalPages}
              </span>
              {result.page < result.totalPages && (
                <Link
                  href={pageHref(result.page + 1)}
                  className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                >
                  Next
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </Container>
  );
}
