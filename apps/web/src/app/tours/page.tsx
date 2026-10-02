import type { Metadata } from 'next';

import { ExperienceListPage } from '@/components/experiences/experience-list-page';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Tours',
  description: 'Guided tours, city walks, zoo trips and adventures across Nigeria.',
  alternates: { canonical: `${env.NEXT_PUBLIC_SITE_URL}/tours` },
};

export default async function ToursPage({ searchParams }: PageProps<'/tours'>) {
  return <ExperienceListPage kind="TOUR" searchParams={await searchParams} />;
}
