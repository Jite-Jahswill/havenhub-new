import type { Metadata } from 'next';

import { ExperienceListPage } from '@/components/experiences/experience-list-page';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Events',
  description: 'Upcoming events, concerts and festivals across Nigeria from verified organisers.',
  alternates: { canonical: `${env.NEXT_PUBLIC_SITE_URL}/events` },
};

export default async function EventsPage({ searchParams }: PageProps<'/events'>) {
  return <ExperienceListPage kind="EVENT" searchParams={await searchParams} />;
}
