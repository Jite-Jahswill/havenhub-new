import {
  EXPERIENCE_KIND_LABELS,
  type ExperienceKind,
  type ExperienceSearchResult,
} from '@havenhub/shared';
import { Alert, Container, buttonClasses } from '@havenhub/ui';
import { SearchX } from 'lucide-react';
import Link from 'next/link';

import { serverApi } from '@/lib/api/server';
import { KIND_SEGMENT } from '@/lib/experiences';

import { ExperienceCard } from './experience-card';
import { ExperienceFilters, type ExperienceFilterState } from './experience-filters';

const INTRO: Record<ExperienceKind, string> = {
  EVENT: 'Concerts, festivals, conferences and parties from verified organisers.',
  TOUR: 'Zoo trips, city walks, cultural experiences and adventures with verified operators.',
  HOTEL: 'Hotels with room types, nightly prices and availability, listed by verified operators.',
  CLEANING: 'Home and office cleaning from verified cleaners near you.',
};

const KEYS = ['q', 'state', 'category', 'when', 'sort', 'page'] as const;

/** Public browse page for one kind; every filter is a URL parameter. */
export async function ExperienceListPage({
  kind,
  searchParams,
}: {
  kind: ExperienceKind;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const state: ExperienceFilterState = {};
  for (const key of KEYS) {
    const value = searchParams[key];
    if (typeof value === 'string' && value) state[key] = value.slice(0, 100);
  }
  const query = new URLSearchParams({ kind, ...state });
  const res = await serverApi<ExperienceSearchResult>(`/experiences?${query}`);
  const basePath = `/${KIND_SEGMENT[kind]}`;
  const label = EXPERIENCE_KIND_LABELS[kind].many;
  const filtered = Boolean(state.q || state.state || state.category);

  const pageHref = (page: number) => {
    const params = new URLSearchParams({ ...state, page: String(page) });
    return `${basePath}?${params}`;
  };

  return (
    <Container className="py-8 lg:py-10">
      <header className="mb-8 max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">{label}</h1>
        <p className="mt-2 text-text-secondary">{INTRO[kind]}</p>
      </header>
      <div className="mb-8">
        <ExperienceFilters kind={kind} basePath={basePath} state={state} />
      </div>

      {!res.success ? (
        <Alert tone="error">
          {res.code === 'VALIDATION_ERROR'
            ? 'Some filters were not valid. Please adjust them and try again.'
            : res.message}
        </Alert>
      ) : res.data.items.length === 0 ? (
        <div className="flex flex-col items-center rounded-card border border-dashed border-border px-6 py-20 text-center">
          <SearchX aria-hidden className="size-8 text-text-muted" strokeWidth={1.5} />
          <h2 className="mt-4 font-semibold text-text">
            {filtered
              ? `No ${label.toLowerCase()} match your search`
              : state.when === 'past'
                ? 'No past events yet'
                : `No ${label.toLowerCase()} listed yet`}
          </h2>
          <p className="mt-1 max-w-sm text-sm text-text-secondary">
            {filtered ? 'Try another place or fewer filters.' : 'Check back soon.'}
          </p>
          {filtered && (
            <Link
              href={basePath}
              className={buttonClasses({ variant: 'secondary', className: 'mt-6' })}
            >
              Clear filters
            </Link>
          )}
        </div>
      ) : (
        <>
          <p className="mb-6 text-sm text-text-secondary" aria-live="polite">
            {res.data.total}{' '}
            {res.data.total === 1
              ? EXPERIENCE_KIND_LABELS[kind].one.toLowerCase()
              : label.toLowerCase()}
          </p>
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {res.data.items.map((item, index) => (
              <ExperienceCard key={item.id} item={item} priority={index < 3} />
            ))}
          </div>
          {res.data.totalPages > 1 && (
            <nav
              aria-label="Pagination"
              className="mt-12 flex items-center justify-center gap-3 text-sm"
            >
              {res.data.page > 1 && (
                <Link
                  href={pageHref(res.data.page - 1)}
                  className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                >
                  Previous
                </Link>
              )}
              <span className="text-text-secondary">
                Page {res.data.page} of {res.data.totalPages}
              </span>
              {res.data.page < res.data.totalPages && (
                <Link
                  href={pageHref(res.data.page + 1)}
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
