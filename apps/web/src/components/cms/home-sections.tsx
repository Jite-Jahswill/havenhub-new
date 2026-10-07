import type { HomepageSectionView } from '@havenhub/shared';
import { Container, buttonClasses } from '@havenhub/ui';
import { MapPin, Quote } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { ExperienceCard } from '@/components/experiences/experience-card';
import { Photo } from '@/components/properties/photo';
import { PropertyCard } from '@/components/properties/property-card';
import type { Viewer } from '@/components/properties/favorite-button';

import { BlogCard } from './blog-card';
import { HeroSection } from './hero-section';

const MORE: Partial<Record<HomepageSectionView['key'], string>> = {
  FEATURED_PROPERTIES: '/properties',
  RENT_PROPERTIES: '/properties?listingType=RENT',
  SALE_PROPERTIES: '/properties?listingType=SALE',
  SPECIAL_OFFERS: '/properties?onOffer=true&sort=discount',
  VACATION_ZONES: '/destinations',
  HOTELS: '/hotels',
  EVENTS: '/events',
  TOURS: '/tours',
  CLEANING: '/cleaning',
  BLOG: '/blog',
};

/** One homepage section, as configured in the CMS (data already filtered to public). */
export function HomeSection({
  section,
  viewer,
  index,
}: {
  section: HomepageSectionView;
  viewer: Viewer;
  index: number;
}) {
  switch (section.key) {
    case 'HERO':
      return <HeroSection section={section} headingLevel={index === 0 ? 1 : 2} />;
    case 'EXPLORE':
      return (
        <Band title={section.title} subtitle={section.subtitle} tinted>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {section.items.map((item) => (
              <li
                key={`${item.title}-${item.href}`}
                className="relative rounded-card border border-border bg-surface p-7 shadow-card transition-colors hover:bg-surface-secondary"
              >
                <h3 className="text-lg font-semibold text-text">
                  <Link
                    href={item.href}
                    className="after:absolute after:inset-0 after:rounded-card focus-visible:outline-none"
                  >
                    {item.title}
                  </Link>
                </h3>
                {item.description && (
                  <p className="mt-2 leading-relaxed text-text-secondary">{item.description}</p>
                )}
              </li>
            ))}
          </ul>
        </Band>
      );
    case 'FEATURED_PROPERTIES':
    case 'RENT_PROPERTIES':
    case 'SALE_PROPERTIES':
    case 'SPECIAL_OFFERS':
    case 'AWARDS':
      return (
        <Band title={section.title} subtitle={section.subtitle} more={MORE[section.key]}>
          <Grid>
            {section.properties.map((p) => (
              <PropertyCard key={p.id} property={p} viewer={viewer} />
            ))}
          </Grid>
        </Band>
      );
    case 'POPULAR_LOCATIONS':
      return (
        <Band title={section.title} subtitle={section.subtitle}>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {section.locations.map((l) => (
              <li key={`${l.city}-${l.state}`}>
                <Link
                  href={`/properties?city=${encodeURIComponent(l.city)}`}
                  className="flex items-center gap-3 rounded-card border border-border bg-surface p-4 hover:bg-surface-secondary"
                >
                  <MapPin aria-hidden className="size-5 shrink-0 text-primary-text" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-text">{l.city}</span>
                    <span className="block text-sm text-text-secondary">
                      {l.state} · {l.count} {l.count === 1 ? 'listing' : 'listings'}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Band>
      );
    case 'VACATION_ZONES':
      return (
        <Band title={section.title} subtitle={section.subtitle} more={MORE.VACATION_ZONES}>
          <Grid>
            {section.zones.map((z) => (
              <article key={z.id} className="group relative">
                <div className="relative aspect-[4/3] overflow-hidden rounded-card bg-surface-secondary">
                  {z.coverImage && (
                    <Photo
                      src={z.coverImage.url}
                      alt={z.name}
                      className="transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                  )}
                </div>
                <h3 className="mt-3 font-semibold text-text">
                  <Link
                    href={`/destinations/${z.slug}`}
                    className="after:absolute after:inset-0 focus-visible:outline-none"
                  >
                    {z.name}
                  </Link>
                </h3>
                {z.state && <p className="text-sm text-text-secondary">{z.state}</p>}
              </article>
            ))}
          </Grid>
        </Band>
      );
    case 'HOTELS':
    case 'EVENTS':
    case 'TOURS':
    case 'CLEANING':
      return (
        <Band title={section.title} subtitle={section.subtitle} more={MORE[section.key]}>
          <Grid>
            {section.experiences.map((e) => (
              <ExperienceCard key={e.id} item={e} />
            ))}
          </Grid>
        </Band>
      );
    case 'BLOG':
      return (
        <Band title={section.title} subtitle={section.subtitle} more={MORE.BLOG}>
          <Grid>
            {section.posts.map((p) => (
              <BlogCard key={p.id} post={p} />
            ))}
          </Grid>
        </Band>
      );
    case 'TESTIMONIALS':
      return (
        <Band title={section.title} subtitle={section.subtitle} tinted>
          <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {section.testimonials.map((t) => (
              <li key={t.id}>
                <figure className="flex h-full flex-col gap-4 rounded-card border border-border bg-surface p-6 shadow-card">
                  <Quote aria-hidden className="size-6 text-primary-text" />
                  <blockquote className="flex-1 leading-relaxed text-text">“{t.quote}”</blockquote>
                  <figcaption className="flex items-center gap-3">
                    {t.photo && (
                      <span className="relative size-10 shrink-0 overflow-hidden rounded-full bg-surface-secondary">
                        <Photo src={t.photo.thumbnailUrl} alt="" sizes="40px" />
                      </span>
                    )}
                    <span className="text-sm">
                      <span className="block font-semibold text-text">{t.authorName}</span>
                      {t.authorRole && (
                        <span className="block text-text-secondary">{t.authorRole}</span>
                      )}
                    </span>
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        </Band>
      );
    case 'CTA':
      return (
        <section className="py-16">
          <Container>
            <div className="flex flex-col items-start gap-5 rounded-card bg-surface-inverse p-8 text-text-inverse sm:p-12 md:flex-row md:items-center md:justify-between">
              <div className="max-w-2xl">
                <h2 className="text-2xl font-bold tracking-tight">{section.title}</h2>
                {section.subtitle && <p className="mt-2 opacity-80">{section.subtitle}</p>}
              </div>
              {section.button && (
                <Link
                  href={section.button.href}
                  className={buttonClasses({ size: 'lg', className: 'shrink-0' })}
                >
                  {section.button.label}
                </Link>
              )}
            </div>
          </Container>
        </section>
      );
  }
}

function Band({
  title,
  subtitle,
  more,
  tinted = false,
  children,
}: {
  title: string | null;
  subtitle: string | null;
  more?: string;
  tinted?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={tinted ? 'bg-surface-secondary py-20' : 'py-16'}>
      <Container>
        {(title || more) && (
          <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
            <div>
              {title && <h2 className="text-2xl font-bold tracking-tight text-text">{title}</h2>}
              {subtitle && <p className="mt-2 text-text-secondary">{subtitle}</p>}
            </div>
            {more && (
              <Link href={more} className="text-sm font-semibold text-primary-text hover:underline">
                View all →
              </Link>
            )}
          </div>
        )}
        {children}
      </Container>
    </section>
  );
}

const Grid = ({ children }: { children: ReactNode }) => (
  <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
);
