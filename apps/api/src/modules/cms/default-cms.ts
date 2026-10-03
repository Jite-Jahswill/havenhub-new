import type { HomepageSectionKey } from '@havenhub/shared';
import { SITEMAP_SECTIONS } from '@havenhub/shared';

import type { PrismaClient } from '../../generated/prisma/client';

/**
 * Initial CMS rows. The homepage reproduces the copy HavenHub shipped with
 * (only Hero and Explore on), so deploying Phase 7 changes nothing visible.
 * Built-in pages start as empty drafts: no legal or company text is
 * invented, and unpublished pages are not public. Idempotent; never edits
 * existing rows.
 */
const SECTIONS: {
  key: HomepageSectionKey;
  enabled: boolean;
  title: string | null;
  subtitle: string | null;
  config: object;
}[] = [
  {
    key: 'HERO',
    enabled: true,
    title: 'Find your next place to live, stay, work, or explore.',
    subtitle:
      'Rentals, short stays, property and land, hotels, events and experiences — all from verified hosts, with clear pricing.',
    config: {
      eyebrow: 'Nigeria’s home for places & experiences',
      showSearch: true,
      searchPlaceholder: 'Where do you want to live or stay?',
      links: [
        { label: 'Short stays', href: '/properties?listingType=RENT&pricingPeriod=DAILY' },
        { label: 'Yearly rentals', href: '/properties?listingType=RENT&pricingPeriod=YEARLY' },
        { label: 'Homes for sale', href: '/properties?listingType=SALE' },
        { label: 'Land', href: '/properties?propertyType=LAND' },
      ],
    },
  },
  {
    key: 'EXPLORE',
    enabled: true,
    title: 'Everything in one place',
    subtitle: null,
    config: {
      items: [
        {
          title: 'Stay',
          description: 'Short stays and serviced apartments, booked by the night.',
          href: '/properties?listingType=RENT&pricingPeriod=DAILY',
        },
        {
          title: 'Rent',
          description: 'Monthly and yearly homes with transparent pricing.',
          href: '/properties?listingType=RENT',
        },
        {
          title: 'Buy',
          description: 'Houses, land and commercial spaces from verified agents.',
          href: '/properties?listingType=SALE',
        },
        {
          title: 'Hotels',
          description: 'Rooms and suites across Nigeria’s favourite cities.',
          href: '/hotels',
        },
        {
          title: 'Events',
          description: 'Concerts, festivals and celebrations near you.',
          href: '/events',
        },
        {
          title: 'Experiences',
          description: 'Tours, cleaning services and vacation destinations.',
          href: '/experiences',
        },
      ],
    },
  },
  {
    key: 'FEATURED_PROPERTIES',
    enabled: false,
    title: 'Featured properties',
    subtitle: null,
    config: { limit: 6 },
  },
  {
    key: 'POPULAR_LOCATIONS',
    enabled: false,
    title: 'Popular locations',
    subtitle: null,
    config: { limit: 8 },
  },
  {
    key: 'RENT_PROPERTIES',
    enabled: false,
    title: 'Properties for rent',
    subtitle: null,
    config: { limit: 6 },
  },
  {
    key: 'SALE_PROPERTIES',
    enabled: false,
    title: 'Properties for sale',
    subtitle: null,
    config: { limit: 6 },
  },
  {
    key: 'VACATION_ZONES',
    enabled: false,
    title: 'Vacation destinations',
    subtitle: null,
    config: { limit: 6 },
  },
  { key: 'HOTELS', enabled: false, title: 'Hotels & stays', subtitle: null, config: { limit: 6 } },
  { key: 'EVENTS', enabled: false, title: 'Upcoming events', subtitle: null, config: { limit: 6 } },
  {
    key: 'TOURS',
    enabled: false,
    title: 'Tours & experiences',
    subtitle: null,
    config: { limit: 6 },
  },
  {
    key: 'CLEANING',
    enabled: false,
    title: 'Cleaning services',
    subtitle: null,
    config: { limit: 6 },
  },
  {
    key: 'SPECIAL_OFFERS',
    enabled: false,
    title: 'Special offers',
    subtitle: null,
    config: { limit: 6 },
  },
  {
    key: 'AWARDS',
    enabled: false,
    title: 'Award-winning properties',
    subtitle: null,
    config: { limit: 6 },
  },
  { key: 'BLOG', enabled: false, title: 'From the blog', subtitle: null, config: { limit: 3 } },
  {
    key: 'TESTIMONIALS',
    enabled: false,
    title: 'What people say',
    subtitle: null,
    config: { limit: 6 },
  },
  { key: 'CTA', enabled: false, title: null, subtitle: null, config: { button: null } },
];

const PAGES = [
  { slug: 'about', title: 'About us' },
  { slug: 'contact', title: 'Contact us' },
  { slug: 'terms', title: 'Terms of service' },
  { slug: 'privacy', title: 'Privacy policy' },
];

export async function seedCmsDefaults(prisma: PrismaClient): Promise<{ created: number }> {
  return prisma.$transaction(async (tx) => {
    // skipDuplicates: the API also creates this row on first read, possibly concurrently.
    const settings = await tx.siteSettings.createMany({
      data: [{ id: 1, sitemapSections: [...SITEMAP_SECTIONS] }],
      skipDuplicates: true,
    });
    const sections = await tx.homepageSection.createMany({
      data: SECTIONS.map((s, sortOrder) => ({ ...s, sortOrder })),
      skipDuplicates: true,
    });
    const pages = await tx.page.createMany({
      data: PAGES.map((p) => ({ ...p, system: true, status: 'DRAFT' as const })),
      skipDuplicates: true,
    });
    return { created: settings.count + sections.count + pages.count };
  });
}
