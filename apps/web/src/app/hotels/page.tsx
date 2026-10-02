import type { Metadata } from 'next';

import { ExperienceListPage } from '@/components/experiences/experience-list-page';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Hotels',
  description: 'Hotels across Nigeria with room types, nightly prices and availability.',
  alternates: { canonical: `${env.NEXT_PUBLIC_SITE_URL}/hotels` },
};

export default async function HotelsPage({ searchParams }: PageProps<'/hotels'>) {
  return <ExperienceListPage kind="HOTEL" searchParams={await searchParams} />;
}
