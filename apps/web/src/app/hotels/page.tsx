import type { Metadata } from 'next';

import { ExperienceListPage } from '@/components/experiences/experience-list-page';
import { routeMetadata } from '@/lib/cms';
import { env } from '@/lib/env';

const BASE_METADATA: Metadata = {
  title: 'Hotels',
  description: 'Hotels across Nigeria with room types, nightly prices and availability.',
  alternates: { canonical: `${env.NEXT_PUBLIC_SITE_URL}/hotels` },
};

/** Admin overrides from the SEO dashboard win over these defaults. */
export function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/hotels', BASE_METADATA);
}

export default async function HotelsPage({ searchParams }: PageProps<'/hotels'>) {
  return <ExperienceListPage kind="HOTEL" searchParams={await searchParams} />;
}
