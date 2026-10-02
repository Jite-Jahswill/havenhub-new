import type { Metadata } from 'next';

import { AdminExperienceList } from '@/components/admin/experience-admin';

export const metadata: Metadata = { title: 'Hotels' };

export default async function AdminHotelsPage({ searchParams }: PageProps<'/admin/hotels'>) {
  return <AdminExperienceList kind="HOTEL" searchParams={await searchParams} />;
}
