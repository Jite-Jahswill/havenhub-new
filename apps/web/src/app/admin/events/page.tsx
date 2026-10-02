import type { Metadata } from 'next';

import { AdminExperienceList } from '@/components/admin/experience-admin';

export const metadata: Metadata = { title: 'Events' };

export default async function AdminEventsPage({ searchParams }: PageProps<'/admin/events'>) {
  return <AdminExperienceList kind="EVENT" searchParams={await searchParams} />;
}
