import type { VacationZoneDetail } from '@havenhub/shared';
import { Container } from '@havenhub/ui';
import { Check } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache, type ReactNode } from 'react';

import { ExperienceCard } from '@/components/experiences/experience-card';
import { Photo } from '@/components/properties/photo';
import { serverApi } from '@/lib/api/server';
import { env } from '@/lib/env';
import { priceRange } from '@/lib/experiences';

const getZone = cache(async (slug: string) => {
  if (!/^[a-z0-9-]{3,80}$/.test(slug)) return null;
  const res = await serverApi<VacationZoneDetail>(`/vacation-zones/${slug}`);
  return res.success ? res.data : null;
});

export async function generateMetadata({
  params,
}: PageProps<'/destinations/[slug]'>): Promise<Metadata> {
  const zone = await getZone((await params).slug);
  if (!zone) return { title: 'Destination not found', robots: { index: false } };
  return {
    title: `${zone.name}${zone.state ? ` · ${zone.state}` : ''}`,
    description: zone.summary ?? `Visiting ${zone.name}: where to stay and what to do.`,
    alternates: { canonical: `${env.NEXT_PUBLIC_SITE_URL}/destinations/${zone.slug}` },
  };
}

export default async function DestinationPage({ params }: PageProps<'/destinations/[slug]'>) {
  const zone = await getZone((await params).slug);
  if (!zone) notFound();
  const range = priceRange(zone.priceRangeMinKobo, zone.priceRangeMaxKobo);

  return (
    <Container className="py-8 lg:py-10">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-text-secondary">
        <Link href="/destinations" className="hover:text-text">
          Destinations
        </Link>
      </nav>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight break-words text-text sm:text-3xl">
          {zone.name}
        </h1>
        {zone.state && <p className="mt-1.5 text-text-secondary">{zone.state}</p>}
      </header>
      {zone.coverImage && (
        <div className="relative mb-10 aspect-[21/9] overflow-hidden rounded-card bg-surface-secondary">
          <Photo src={zone.coverImage.url} alt={zone.name} sizes="100vw" priority />
        </div>
      )}
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-10">
          {zone.description && (
            <Section title="About">
              <p className="leading-relaxed break-words whitespace-pre-line text-text-secondary">
                {zone.description}
              </p>
            </Section>
          )}
          <List title="Things to do" items={zone.activities} />
          <List title="Nearby attractions" items={zone.nearbyAttractions} />
          {zone.accommodation && (
            <Section title="Where to stay">
              <p className="leading-relaxed break-words whitespace-pre-line text-text-secondary">
                {zone.accommodation}
              </p>
            </Section>
          )}
          {zone.hospitality && (
            <Section title="Hospitality">
              <p className="leading-relaxed break-words whitespace-pre-line text-text-secondary">
                {zone.hospitality}
              </p>
            </Section>
          )}
        </div>
        <aside className="flex flex-col gap-6">
          {range && (
            <div className="rounded-card border border-border p-6">
              <p className="text-sm text-text-secondary">Typical prices</p>
              <p className="mt-1 text-xl font-bold text-text">{range}</p>
              <p className="mt-2 text-xs text-text-muted">An indication only, not a quote.</p>
            </div>
          )}
          {zone.offers && (
            <div className="rounded-card border border-border p-6">
              <p className="text-sm font-semibold text-text">Offers</p>
              <p className="mt-2 text-sm break-words whitespace-pre-line text-text-secondary">
                {zone.offers}
              </p>
            </div>
          )}
        </aside>
      </div>

      {zone.experiences.length > 0 && (
        <section aria-labelledby="featured-heading" className="mt-16">
          <h2 id="featured-heading" className="mb-6 text-xl font-bold tracking-tight text-text">
            Tours & hotels in {zone.name}
          </h2>
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {zone.experiences.map((item) => (
              <ExperienceCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
    </Container>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <Section title={title}>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item} className="flex items-center gap-3 break-words text-text-secondary">
            <Check aria-hidden className="size-4 shrink-0 text-success" />
            {item}
          </li>
        ))}
      </ul>
    </Section>
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
