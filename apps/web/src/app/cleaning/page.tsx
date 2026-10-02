import type { Metadata } from 'next';

import { ExperienceListPage } from '@/components/experiences/experience-list-page';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Cleaning services',
  description: 'Verified home and office cleaners across Nigeria.',
  alternates: { canonical: `${env.NEXT_PUBLIC_SITE_URL}/cleaning` },
};

export default async function CleaningPage({ searchParams }: PageProps<'/cleaning'>) {
  return <ExperienceListPage kind="CLEANING" searchParams={await searchParams} />;
}
