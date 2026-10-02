import type { Paginated, PropertyCard as PropertyCardData } from '@havenhub/shared';
import { Card, buttonClasses } from '@havenhub/ui';
import { Heart } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { PropertyCard } from '@/components/properties/property-card';
import { serverApiData } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Favourites' };

export default async function FavoritesPage() {
  const favorites = await serverApiData<Paginated<PropertyCardData>>('/favorites?pageSize=100');
  return (
    <>
      <PageHeader title="Favourites" description="Places you’ve saved." />
      {!favorites?.items.length ? (
        <Card className="flex flex-col items-center px-6 py-20 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-surface-secondary text-text-secondary">
            <Heart aria-hidden className="size-6" strokeWidth={1.6} />
          </span>
          <h2 className="mt-6 text-lg font-semibold text-text">No favourites yet</h2>
          <p className="mt-2 max-w-sm text-text-secondary">
            Tap the heart on any listing to save it here.
          </p>
          <Link href="/properties" className={buttonClasses({ className: 'mt-6' })}>
            Explore properties
          </Link>
        </Card>
      ) : (
        <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
          {favorites.items.map((property) => (
            <PropertyCard key={property.id} property={property} viewer="customer" favorite />
          ))}
        </div>
      )}
    </>
  );
}
