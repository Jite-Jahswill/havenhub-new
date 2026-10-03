import type { Paginated, VacationZoneCard } from '@havenhub/shared';
import { Alert, Container } from '@havenhub/ui';
import { ImageOff, Palmtree } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Photo } from '@/components/properties/photo';
import { serverApi } from '@/lib/api/server';
import { routeMetadata } from '@/lib/cms';
import { env } from '@/lib/env';
import { priceRange } from '@/lib/experiences';

const BASE_METADATA: Metadata = {
  title: 'Vacation destinations',
  description: 'Holiday destinations across Nigeria: where to stay, what to do and what it costs.',
  alternates: { canonical: `${env.NEXT_PUBLIC_SITE_URL}/destinations` },
};

/** Admin overrides from the SEO dashboard win over these defaults. */
export function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/destinations', BASE_METADATA);
}

export default async function DestinationsPage({ searchParams }: PageProps<'/destinations'>) {
  const { page } = await searchParams;
  const p = typeof page === 'string' && /^\d{1,4}$/.test(page) ? page : '1';
  const res = await serverApi<Paginated<VacationZoneCard>>(`/vacation-zones?page=${p}`);

  return (
    <Container className="py-8 lg:py-10">
      <header className="mb-8 max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">Destinations</h1>
        <p className="mt-2 text-text-secondary">
          Holiday spots across Nigeria, with where to stay, what to do and typical prices.
        </p>
      </header>
      {!res.success ? (
        <Alert tone="error">{res.message}</Alert>
      ) : res.data.items.length === 0 ? (
        <div className="flex flex-col items-center rounded-card border border-dashed border-border px-6 py-20 text-center">
          <Palmtree aria-hidden className="size-8 text-text-muted" strokeWidth={1.5} />
          <h2 className="mt-4 font-semibold text-text">No destinations yet</h2>
          <p className="mt-1 text-sm text-text-secondary">Check back soon.</p>
        </div>
      ) : (
        <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {res.data.items.map((zone, index) => {
            const range = priceRange(zone.priceRangeMinKobo, zone.priceRangeMaxKobo);
            return (
              <li key={zone.id} className="group relative flex flex-col">
                <div className="relative aspect-[4/3] overflow-hidden rounded-card bg-surface-secondary">
                  {zone.coverImage ? (
                    <Photo
                      src={zone.coverImage.url}
                      alt={zone.name}
                      priority={index < 3}
                      className="transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="grid size-full place-items-center text-text-muted">
                      <ImageOff aria-hidden className="size-8" strokeWidth={1.4} />
                    </div>
                  )}
                </div>
                <h2 className="mt-3.5 font-semibold text-text">
                  <Link
                    href={`/destinations/${zone.slug}`}
                    className="after:absolute after:inset-0 focus-visible:outline-none"
                  >
                    {zone.name}
                  </Link>
                </h2>
                {zone.state && <p className="text-sm text-text-secondary">{zone.state}</p>}
                {zone.summary && (
                  <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{zone.summary}</p>
                )}
                {range && <p className="mt-1 text-sm font-medium text-text">{range}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}
