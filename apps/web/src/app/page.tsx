import type { HomepageSectionView } from '@havenhub/shared';
import type { Metadata } from 'next';

import { HomeSection } from '@/components/cms/home-sections';
import { cmsData, routeMetadata } from '@/lib/cms';
import { getCurrentUser } from '@/lib/session';

export function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/', {});
}

/** Shown if the CMS cannot be reached, so the homepage never breaks. */
const FALLBACK: HomepageSectionView[] = [
  {
    key: 'HERO',
    eyebrow: 'Nigeria’s home for places & experiences',
    title: 'Find your next place to live, stay, work, or explore.',
    subtitle:
      'Rentals, short stays, property and land, hotels, events and experiences — all from verified hosts, with clear pricing.',
    showSearch: true,
    searchPlaceholder: 'Where do you want to live or stay?',
    links: [],
  },
];

/** The homepage, built from the sections an administrator has enabled and ordered. */
export default async function HomePage() {
  const [sections, user] = await Promise.all([
    cmsData<HomepageSectionView[]>('/homepage'),
    getCurrentUser(),
  ]);
  const viewer = !user ? 'guest' : user.accountType === 'CUSTOMER' ? 'customer' : 'other';
  const shown = sections?.length ? sections : FALLBACK;
  const hasH1 = shown[0]?.key === 'HERO' && Boolean(shown[0].title);
  return (
    <>
      {!hasH1 && <h1 className="sr-only">HavenHub</h1>}
      {shown.map((section, index) => (
        <HomeSection key={section.key} section={section} viewer={viewer} index={index} />
      ))}
    </>
  );
}
