import type { Metadata } from 'next';

import { ExperienceListPage } from '@/components/experiences/experience-list-page';
import { routeMetadata } from '@/lib/cms';
import { env } from '@/lib/env';

const BASE_METADATA: Metadata = {
  title: 'Cleaning services',
  description: 'Verified home and office cleaners across Nigeria.',
  alternates: { canonical: `${env.NEXT_PUBLIC_SITE_URL}/cleaning` },
};

/** Admin overrides from the SEO dashboard win over these defaults. */
export function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/cleaning', BASE_METADATA);
}

export default async function CleaningPage({ searchParams }: PageProps<'/cleaning'>) {
  return <ExperienceListPage kind="CLEANING" searchParams={await searchParams} />;
}
