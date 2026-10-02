'use client';

import dynamic from 'next/dynamic';

/** Client-only wrapper so Server Components can render a map. */
export const LocationMapLazy = dynamic(() => import('./location-map').then((m) => m.LocationMap), {
  ssr: false,
  loading: () => <div className="size-full animate-pulse bg-surface-secondary" />,
});
