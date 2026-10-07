import type { PropertyCard as PropertyCardData } from '@havenhub/shared';
import { Badge, cn } from '@havenhub/ui';
import { BadgeCheck, Bath, BedDouble, ImageOff, Ruler, Users } from 'lucide-react';
import Link from 'next/link';

import { discountedKobo, formatPrice } from '@/lib/format';
import { LISTING_TYPE_LABELS, PROPERTY_TYPE_LABELS } from '@/lib/labels';

import { FavoriteButton, type Viewer } from './favorite-button';
import { PropertyBadges } from './property-badges';
import { Rating } from './rating';
import { Photo } from './photo';

export function PropertyCard({
  property,
  favorite = false,
  viewer,
  active = false,
  priority = false,
}: {
  property: PropertyCardData;
  favorite?: boolean;
  viewer: Viewer;
  active?: boolean;
  priority?: boolean;
}) {
  const discounted = discountedKobo(property.priceKobo, property.discountPercent);
  return (
    <article
      className={cn(
        'group relative flex flex-col rounded-card transition-shadow',
        active && 'ring-2 ring-primary ring-offset-4 ring-offset-background',
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded-card bg-surface-secondary">
        {property.coverImage ? (
          <Photo
            src={property.coverImage.url}
            alt={property.coverImage.altText ?? property.title}
            priority={priority}
            className="transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid size-full place-items-center text-text-muted">
            <ImageOff aria-hidden className="size-8" strokeWidth={1.4} />
          </div>
        )}
        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            <Badge className="bg-surface/90 text-text backdrop-blur">
              {LISTING_TYPE_LABELS[property.listingType]}
            </Badge>
            {property.discountPercent && (
              <Badge tone="primary">{property.discountPercent}% off</Badge>
            )}
          </div>
          <div className="relative z-10">
            <FavoriteButton propertyId={property.id} initial={favorite} viewer={viewer} />
          </div>
        </div>
        <PropertyBadges badges={property.badges} compact className="absolute bottom-3 left-3" />
      </div>

      <div className="mt-3.5 flex flex-col gap-1 px-0.5">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
            {PROPERTY_TYPE_LABELS[property.propertyType]} · {property.city}, {property.state}
          </p>
          <Rating rating={property.rating} className="shrink-0 text-xs" />
        </div>
        <h3 className="line-clamp-1 font-semibold text-text">
          <Link
            href={`/properties/${property.slug}`}
            className="after:absolute after:inset-0 focus-visible:outline-none"
          >
            {property.title}
          </Link>
        </h3>
        <Facts property={property} />
        <p className="mt-1 text-text">
          {discounted ? (
            <>
              <span className="font-semibold">
                {formatPrice(discounted, property.pricingPeriod)}
              </span>{' '}
              <span className="text-sm text-text-muted line-through">
                {formatPrice(property.priceKobo)}
              </span>
            </>
          ) : (
            <span className="font-semibold">
              {formatPrice(property.priceKobo, property.pricingPeriod)}
            </span>
          )}
        </p>
        <p className="flex items-center gap-1 text-xs text-text-muted">
          <BadgeCheck aria-hidden className="size-3.5 text-success" />
          <span className="truncate">{property.agent.displayName}</span>
          <span className="sr-only">(verified agent)</span>
        </p>
      </div>
    </article>
  );
}

function Facts({ property }: { property: PropertyCardData }) {
  const facts: { icon: typeof BedDouble; label: string }[] = [];
  if (property.bedrooms !== null)
    facts.push({ icon: BedDouble, label: `${property.bedrooms} bed` });
  if (property.bathrooms !== null) facts.push({ icon: Bath, label: `${property.bathrooms} bath` });
  if (property.maxGuests !== null && property.pricingPeriod === 'DAILY') {
    facts.push({ icon: Users, label: `${property.maxGuests} guests` });
  }
  if (property.sizeSqm !== null && facts.length < 3)
    facts.push({ icon: Ruler, label: `${property.sizeSqm.toLocaleString()} m²` });
  if (!facts.length) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-text-secondary">
      {facts.map(({ icon: Icon, label }) => (
        <li key={label} className="flex items-center gap-1">
          <Icon aria-hidden className="size-3.5" strokeWidth={1.8} />
          {label}
        </li>
      ))}
    </ul>
  );
}

export function PropertyGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {children}
    </div>
  );
}
