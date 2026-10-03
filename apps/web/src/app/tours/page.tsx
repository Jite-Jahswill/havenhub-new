import type { Metadata } from 'next';

import { ExperienceListPage } from '@/components/experiences/experience-list-page';
import { routeMetadata } from '@/lib/cms';
import { env } from '@/lib/env';

const BASE_METADATA: Metadata = {
  title: 'Tours',
  description: 'Guided tours, city walks, zoo trips and adventures across Nigeria.',
  alternates: { canonical: `${env.NEXT_PUBLIC_SITE_URL}/tours` },
};

/** Admin overrides from the SEO dashboard win over these defaults. */
export function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/tours', BASE_METADATA);
}

export default async function ToursPage({ searchParams }: PageProps<'/tours'>) {
  return <ExperienceListPage kind="TOUR" searchParams={await searchParams} />;
}
