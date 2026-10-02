import type { PropertyCard as PropertyCardData, PropertyDetail } from '@havenhub/shared';
import { videoEmbedUrl } from '@havenhub/shared';
import { Alert, Badge, Card, Container } from '@havenhub/ui';
import {
  Bath,
  BadgeCheck,
  BedDouble,
  CalendarDays,
  Car,
  Check,
  Ruler,
  Sofa,
  Sparkles,
  Toilet,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache, type ReactNode } from 'react';

import { BookingWidget } from '@/components/bookings/booking-widget';
import { LocationMapLazy } from '@/components/map/location-map-lazy';
import { AgentAvatar } from '@/components/properties/agent-avatar';
import { FavoriteButton } from '@/components/properties/favorite-button';
import { Gallery } from '@/components/properties/gallery';
import { PropertyCard } from '@/components/properties/property-card';
import { ShareButton } from '@/components/properties/share-button';
import { ViewBeacon } from '@/components/properties/view-beacon';
import { serverApi, serverApiData } from '@/lib/api/server';
import { env } from '@/lib/env';
import { discountedKobo, formatPrice } from '@/lib/format';
import {
  AMENITY_CATEGORY_LABELS,
  CLEANING_LABELS,
  LISTING_TYPE_LABELS,
  PERIOD_LABELS,
  PROPERTY_TYPE_LABELS,
} from '@/lib/labels';
import { getCurrentUser } from '@/lib/session';

const getProperty = cache(async (slug: string) => {
  const res = await serverApi<PropertyDetail>(`/properties/${encodeURIComponent(slug)}`);
  return res.success ? res.data : null;
});

const absolute = (url: string) =>
  url.startsWith('http') ? url : `${env.NEXT_PUBLIC_SITE_URL}${url}`;

export async function generateMetadata({
  params,
}: PageProps<'/properties/[slug]'>): Promise<Metadata> {
  const property = await getProperty((await params).slug);
  if (!property) return { title: 'Property not found', robots: { index: false } };
  const title = `${property.title} · ${property.city}, ${property.state}`;
  const description = `${LISTING_TYPE_LABELS[property.listingType]} in ${property.city}: ${property.description.slice(0, 140)}`;
  const url = `${env.NEXT_PUBLIC_SITE_URL}/properties/${property.slug}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: 'website',
      siteName: 'HavenHub',
      images: property.coverImage
        ? [{ url: absolute(property.coverImage.url), alt: property.title }]
        : undefined,
    },
    twitter: { card: property.coverImage ? 'summary_large_image' : 'summary', title, description },
  };
}

export default async function PropertyPage({ params }: PageProps<'/properties/[slug]'>) {
  const { slug } = await params;
  const [property, user] = await Promise.all([getProperty(slug), getCurrentUser()]);
  if (!property) notFound();
  const similar =
    (await serverApiData<PropertyCardData[]>(`/properties/${encodeURIComponent(slug)}/similar`)) ??
    [];
  const viewer = !user ? 'guest' : user.accountType === 'CUSTOMER' ? 'customer' : 'other';
  const discounted = discountedKobo(property.priceKobo, property.discountPercent);

  const amenityGroups = Object.entries(AMENITY_CATEGORY_LABELS)
    .map(([category, label]) => ({
      label,
      items: property.amenities.filter((a) => a.category === category),
    }))
    .filter((g) => g.items.length);

  return (
    <Container className="py-8 lg:py-10">
      <ViewBeacon propertyId={property.id} />
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-text-secondary">
        <Link href="/properties" className="hover:text-text">
          Properties
        </Link>{' '}
        /{' '}
        <Link
          href={`/properties?city=${encodeURIComponent(property.city)}`}
          className="hover:text-text"
        >
          {property.city}
        </Link>
      </nav>

      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge>{PROPERTY_TYPE_LABELS[property.propertyType]}</Badge>
            <Badge tone="primary">{LISTING_TYPE_LABELS[property.listingType]}</Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">
            {property.title}
          </h1>
          <p className="mt-1.5 text-text-secondary">
            {property.lga}, {property.city}, {property.state}
          </p>
        </div>
        <div className="flex gap-2">
          <ShareButton title={property.title} />
          <FavoriteButton
            propertyId={property.id}
            initial={property.isFavorite}
            viewer={viewer}
            variant="inline"
          />
        </div>
      </header>

      {property.images.length > 0 && <Gallery images={property.images} title={property.title} />}

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-10">
          <KeyFacts property={property} />

          <Section title="About this place">
            <p className="leading-relaxed whitespace-pre-line text-text-secondary">
              {property.description}
            </p>
          </Section>

          {amenityGroups.length > 0 && (
            <Section title="What this place offers">
              <div className="grid gap-8 sm:grid-cols-2">
                {amenityGroups.map((group) => (
                  <div key={group.label}>
                    <h3 className="mb-3 text-sm font-semibold text-text">{group.label}</h3>
                    <ul className="flex flex-col gap-2.5">
                      {group.items.map((amenity) => (
                        <li
                          key={amenity.id}
                          className="flex items-center gap-3 text-text-secondary"
                        >
                          <Check aria-hidden className="size-4 text-success" />
                          {amenity.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {(property.cleaningOption || property.cautionFeeKobo) && (
            <Section title="Fees & services">
              <dl className="grid gap-4 sm:grid-cols-2">
                {property.cleaningOption && (
                  <Fact icon={<Sparkles aria-hidden className="size-5" />} label="Cleaning">
                    {CLEANING_LABELS[property.cleaningOption]}
                    {property.cleaningOption === 'AVAILABLE_FOR_FEE' && property.cleaningFeeKobo
                      ? ` (${formatPrice(property.cleaningFeeKobo)})`
                      : ''}
                  </Fact>
                )}
                {property.cautionFeeKobo ? (
                  <Fact
                    icon={<BadgeCheck aria-hidden className="size-5" />}
                    label="Caution fee (refundable)"
                  >
                    {formatPrice(property.cautionFeeKobo)}
                  </Fact>
                ) : null}
              </dl>
            </Section>
          )}

          {property.videos.length > 0 && (
            <Section title="Video tour">
              <div className="grid gap-4">
                {property.videos.map((video) => (
                  <div
                    key={video.id}
                    className="aspect-video overflow-hidden rounded-card bg-surface-secondary"
                  >
                    <iframe
                      src={videoEmbedUrl(video)}
                      title={video.title ?? `${property.title} video`}
                      loading="lazy"
                      allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                      referrerPolicy="strict-origin-when-cross-origin"
                      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                      className="size-full"
                    />
                  </div>
                ))}
              </div>
            </Section>
          )}

          <Section title="Location">
            <p className="mb-4 text-text-secondary">
              {property.addressLine}, {property.lga}, {property.city}, {property.state}
            </p>
            <div className="h-80 overflow-hidden rounded-card border border-border">
              <LocationMapLazy latitude={property.latitude} longitude={property.longitude} />
            </div>
          </Section>

          <Section title="Listed by">
            <Link
              href={`/agents/${property.agent.id}`}
              className="flex items-center gap-4 rounded-card border border-border p-5 hover:bg-surface-secondary"
            >
              <AgentAvatar name={property.agent.displayName} url={property.agent.avatarUrl} />
              <div>
                <p className="flex items-center gap-1.5 font-semibold text-text">
                  {property.agent.displayName}
                  <BadgeCheck aria-label="Verified agent" className="size-4.5 text-success" />
                </p>
                <p className="text-sm text-text-secondary">
                  Verified agent · {property.agent.publishedPropertyCount} listing
                  {property.agent.publishedPropertyCount === 1 ? '' : 's'} · Member since{' '}
                  {new Date(property.agent.memberSince).getFullYear()}
                </p>
              </div>
            </Link>
          </Section>
        </div>

        <aside>
          <Card className="sticky top-26 flex flex-col gap-5 p-6">
            <div>
              <p className="text-sm text-text-secondary">{PERIOD_LABELS[property.pricingPeriod]}</p>
              {discounted ? (
                <p className="mt-1">
                  <span className="text-2xl font-bold text-text">
                    {formatPrice(discounted, property.pricingPeriod)}
                  </span>{' '}
                  <span className="text-text-muted line-through">
                    {formatPrice(property.priceKobo)}
                  </span>
                  <Badge tone="primary" className="ml-2">
                    {property.discountPercent}% off
                  </Badge>
                </p>
              ) : (
                <p className="mt-1 text-2xl font-bold text-text">
                  {formatPrice(property.priceKobo, property.pricingPeriod)}
                </p>
              )}
            </div>
            {property.availableFrom && (
              <p className="flex items-center gap-2 text-sm text-text-secondary">
                <CalendarDays aria-hidden className="size-4" /> Available from{' '}
                {new Date(property.availableFrom).toLocaleDateString('en-NG', {
                  dateStyle: 'medium',
                })}
              </p>
            )}
            {property.listingType === 'SALE' ? (
              <Alert>Purchase enquiries and secure payments are coming soon to HavenHub.</Alert>
            ) : (
              <BookingWidget property={property} viewer={viewer} />
            )}
          </Card>
        </aside>
      </div>

      {similar.length > 0 && (
        <section aria-labelledby="similar-heading" className="mt-20">
          <h2 id="similar-heading" className="mb-6 text-xl font-bold tracking-tight text-text">
            Similar places
          </h2>
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {similar.map((item) => (
              <PropertyCard key={item.id} property={item} viewer={viewer} />
            ))}
          </div>
        </section>
      )}
    </Container>
  );
}

function KeyFacts({ property }: { property: PropertyDetail }) {
  const facts: { icon: ReactNode; label: string; value: string }[] = [];
  if (property.bedrooms !== null)
    facts.push({
      icon: <BedDouble aria-hidden className="size-5" />,
      label: 'Bedrooms',
      value: String(property.bedrooms),
    });
  if (property.bathrooms !== null)
    facts.push({
      icon: <Bath aria-hidden className="size-5" />,
      label: 'Bathrooms',
      value: String(property.bathrooms),
    });
  if (property.toilets !== null)
    facts.push({
      icon: <Toilet aria-hidden className="size-5" />,
      label: 'Toilets',
      value: String(property.toilets),
    });
  if (property.maxGuests !== null)
    facts.push({
      icon: <Users aria-hidden className="size-5" />,
      label: 'Guests',
      value: `Up to ${property.maxGuests}`,
    });
  if (property.sizeSqm !== null)
    facts.push({
      icon: <Ruler aria-hidden className="size-5" />,
      label: 'Size',
      value: `${property.sizeSqm.toLocaleString()} m²`,
    });
  if (property.parkingSpaces !== null)
    facts.push({
      icon: <Car aria-hidden className="size-5" />,
      label: 'Parking',
      value: String(property.parkingSpaces),
    });
  if (property.furnished || property.serviced) {
    facts.push({
      icon: <Sofa aria-hidden className="size-5" />,
      label: 'Setup',
      value: [property.furnished && 'Furnished', property.serviced && 'Serviced']
        .filter(Boolean)
        .join(' · '),
    });
  }
  if (!facts.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-4 border-b border-border pb-10 sm:grid-cols-3">
      {facts.map((fact) => (
        <Fact key={fact.label} icon={fact.icon} label={fact.label}>
          {fact.value}
        </Fact>
      ))}
    </dl>
  );
}

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-text-muted">{icon}</span>
      <div>
        <dt className="text-sm text-text-muted">{label}</dt>
        <dd className="font-medium text-text">{children}</dd>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border pb-10 last:border-0">
      <h2 className="mb-5 text-xl font-bold tracking-tight text-text">{title}</h2>
      {children}
    </section>
  );
}
