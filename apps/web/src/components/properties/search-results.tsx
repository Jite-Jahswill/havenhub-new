'use client';

import type { PropertySearchResult } from '@havenhub/shared';
import { Button, Select, buttonClasses, cn } from '@havenhub/ui';
import { List, Map as MapIcon, SearchX } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import type { Bounds } from '@/components/map/property-map';
import { formatCompactPrice, plural } from '@/lib/format';

import type { Viewer } from './favorite-button';
import { PropertyCard } from './property-card';
import type { SearchState } from './search-filters';

const PropertyMap = dynamic(
  () => import('@/components/map/property-map').then((m) => m.PropertyMap),
  {
    ssr: false,
    loading: () => <div className="size-full animate-pulse bg-surface-secondary" />,
  },
);

const SORTS = [
  ['newest', 'Newest'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['discount', 'Biggest discount'],
] as const;

export function SearchResults({
  result,
  state,
  viewer,
}: {
  result: PropertySearchResult;
  state: SearchState;
  viewer: Viewer;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobileMap, setMobileMap] = useState(false);
  // The "search this area" offer belongs to the results it was made for.
  const [moved, setMoved] = useState<{ bounds: Bounds; for: PropertySearchResult } | null>(null);
  const movedTo = moved?.for === result ? moved.bounds : null;
  const favorites = useMemo(() => new Set(result.favoriteIds), [result.favoriteIds]);

  const markers = useMemo(
    () =>
      result.items.map((p) => ({
        id: p.id,
        latitude: p.latitude,
        longitude: p.longitude,
        label: formatCompactPrice(p.priceKobo),
        title: p.title,
      })),
    [result.items],
  );

  const href = (patch: SearchState) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...state, ...patch }))
      if (value) next.set(key, value);
    return `${pathname}?${next.toString()}`;
  };

  function selectFromMap(id: string) {
    setActiveId(id);
    setMobileMap(false);
    requestAnimationFrame(() =>
      document
        .getElementById(`property-${id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
  }

  function searchArea() {
    if (!movedTo) return;
    const box = [movedTo.west, movedTo.south, movedTo.east, movedTo.north]
      .map((n) => n.toFixed(4))
      .join(',');
    router.push(href({ bbox: box, page: undefined }), { scroll: false });
  }

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:gap-8 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <section aria-labelledby="results-heading" className={cn(mobileMap && 'hidden lg:block')}>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 id="results-heading" className="text-sm text-text-secondary" aria-live="polite">
            {result.total === 0 ? 'No homes found' : `${plural(result.total, 'place')} to explore`}
            {state.bbox && (
              <>
                {' '}
                in this area ·{' '}
                <Link
                  href={href({ bbox: undefined, page: undefined })}
                  className="font-medium text-text underline underline-offset-4"
                >
                  Search everywhere
                </Link>
              </>
            )}
          </h2>
          <Select
            aria-label="Sort results"
            value={state.sort ?? 'newest'}
            onChange={(e) =>
              router.push(
                href({
                  sort: e.target.value === 'newest' ? undefined : e.target.value,
                  page: undefined,
                }),
                { scroll: false },
              )
            }
            className="h-9 w-auto rounded-full text-sm"
          >
            {SORTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        {result.items.length === 0 ? (
          <div className="flex flex-col items-center rounded-card border border-dashed border-border px-6 py-20 text-center">
            <SearchX aria-hidden className="size-8 text-text-muted" strokeWidth={1.5} />
            <h3 className="mt-4 font-semibold text-text">No properties match these filters</h3>
            <p className="mt-2 max-w-sm text-sm text-text-secondary">
              Try widening the price range, removing a filter or searching a nearby area.
            </p>
            <Link
              href={pathname}
              className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'mt-6' })}
            >
              Clear filters
            </Link>
          </div>
        ) : (
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2">
            {result.items.map((property, index) => (
              <div
                key={property.id}
                id={`property-${property.id}`}
                onMouseEnter={() => setActiveId(property.id)}
                onFocus={() => setActiveId(property.id)}
                className="scroll-mt-28"
              >
                <PropertyCard
                  property={property}
                  favorite={favorites.has(property.id)}
                  viewer={viewer}
                  active={activeId === property.id}
                  priority={index < 2}
                />
              </div>
            ))}
          </div>
        )}

        {result.totalPages > 1 && (
          <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-3">
            {result.page > 1 && (
              <Link
                href={href({ page: String(result.page - 1) })}
                className={buttonClasses({ variant: 'secondary', size: 'sm' })}
              >
                Previous
              </Link>
            )}
            <span className="text-sm text-text-secondary">
              Page {result.page} of {result.totalPages}
            </span>
            {result.page < result.totalPages && (
              <Link
                href={href({ page: String(result.page + 1) })}
                className={buttonClasses({ variant: 'secondary', size: 'sm' })}
              >
                Next
              </Link>
            )}
          </nav>
        )}
      </section>

      <aside
        aria-label="Map"
        className={cn(
          'fixed inset-x-0 top-18 bottom-0 z-30 bg-surface lg:sticky lg:top-26 lg:z-0 lg:block lg:h-[calc(100dvh-8.5rem)] lg:overflow-hidden lg:rounded-card lg:border lg:border-border',
          mobileMap ? 'block' : 'hidden',
        )}
      >
        <PropertyMap
          markers={markers}
          activeId={activeId}
          onSelect={selectFromMap}
          onMoveEnd={(bounds) => setMoved({ bounds, for: result })}
        />
        {movedTo && (
          <Button
            size="sm"
            onClick={searchArea}
            className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full shadow-raised"
          >
            Search this area
          </Button>
        )}
      </aside>

      <button
        type="button"
        onClick={() => setMobileMap((v) => !v)}
        className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-surface-inverse px-5 py-3 text-sm font-semibold text-text-inverse shadow-overlay lg:hidden"
      >
        {mobileMap ? (
          <List aria-hidden className="size-4" />
        ) : (
          <MapIcon aria-hidden className="size-4" />
        )}
        {mobileMap ? 'Show list' : 'Show map'}
      </button>
    </div>
  );
}
