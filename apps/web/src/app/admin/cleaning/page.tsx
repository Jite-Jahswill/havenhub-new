import type { Metadata } from 'next';

import { AdminExperienceList } from '@/components/admin/experience-admin';

export const metadata: Metadata = { title: 'Cleaning services' };

export default async function AdminCleaningPage({ searchParams }: PageProps<'/admin/cleaning'>) {
  return <AdminExperienceList kind="CLEANING" searchParams={await searchParams} />;
}
