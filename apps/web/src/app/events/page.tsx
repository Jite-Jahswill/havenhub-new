import type { Metadata } from 'next';

import { ExperienceListPage } from '@/components/experiences/experience-list-page';
import { routeMetadata } from '@/lib/cms';
import { env } from '@/lib/env';

const BASE_METADATA: Metadata = {
  title: 'Events',
  description: 'Upcoming events, concerts and festivals across Nigeria from verified organisers.',
  alternates: { canonical: `${env.NEXT_PUBLIC_SITE_URL}/events` },
};

/** Admin overrides from the SEO dashboard win over these defaults. */
export function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/events', BASE_METADATA);
}

export default async function EventsPage({ searchParams }: PageProps<'/events'>) {
  return <ExperienceListPage kind="EVENT" searchParams={await searchParams} />;
}
