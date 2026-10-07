import type { AmenityView, PropertySearchResult } from '@havenhub/shared';
import { Alert, Container } from '@havenhub/ui';
import type { Metadata } from 'next';

import { SearchFilters, type SearchState } from '@/components/properties/search-filters';
import { SearchResults } from '@/components/properties/search-results';
import { serverApi, serverApiData } from '@/lib/api/server';
import { routeMetadata } from '@/lib/cms';
import { env } from '@/lib/env';
import { getCurrentUser } from '@/lib/session';

const BASE_METADATA: Metadata = {
  title: 'Find a place to rent, stay or buy',
  description:
    'Browse verified rentals, short stays, homes and land for sale across Nigeria — with clear prices and verified agents.',
  alternates: { canonical: `${env.NEXT_PUBLIC_SITE_URL}/properties` },
};

/** Admin overrides from the SEO dashboard win over these defaults. */
export function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/properties', BASE_METADATA);
}

const KEYS = [
  'q',
  'state',
  'city',
  'propertyType',
  'listingType',
  'pricingPeriod',
  'minPrice',
  'maxPrice',
  'minBedrooms',
  'minBathrooms',
  'minGuests',
  'furnished',
  'cleaningIncluded',
  'onOffer',
  'amenities',
  'bbox',
  'sort',
  'page',
] as const;

export default async function PropertiesPage({ searchParams }: PageProps<'/properties'>) {
  const params = await searchParams;
  const state: SearchState = {};
  for (const key of KEYS) {
    const value = params[key];
    if (typeof value === 'string' && value) state[key] = value;
  }
  const query = new URLSearchParams(state as Record<string, string>);

  const [result, amenities, user] = await Promise.all([
    serverApi<PropertySearchResult>(`/properties?${query.toString()}`),
    serverApiData<AmenityView[]>('/amenities'),
    getCurrentUser(),
  ]);
  const viewer = !user ? 'guest' : user.accountType === 'CUSTOMER' ? 'customer' : 'other';

  return (
    <Container className="max-w-[1600px] py-8 lg:py-10">
      <h1 className="sr-only">Properties</h1>
      <div className="mb-8 max-w-3xl">
        <SearchFilters state={state} amenities={amenities ?? []} />
      </div>
      {result.success ? (
        <SearchResults result={result.data} state={state} viewer={viewer} />
      ) : (
        <Alert tone="error">
          {result.code === 'VALIDATION_ERROR'
            ? 'Some filters were not valid. Please adjust them and try again.'
            : result.message}
        </Alert>
      )}
    </Container>
  );
}
