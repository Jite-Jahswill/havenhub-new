import type { Metadata } from 'next';

import { AdminExperienceList } from '@/components/admin/experience-admin';

export const metadata: Metadata = { title: 'Tours' };

export default async function AdminToursPage({ searchParams }: PageProps<'/admin/tours'>) {
  return <AdminExperienceList kind="TOUR" searchParams={await searchParams} />;
}
