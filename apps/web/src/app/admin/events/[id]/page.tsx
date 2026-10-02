import type { Metadata } from 'next';

import { AdminExperienceReview } from '@/components/admin/experience-admin';

export const metadata: Metadata = { title: 'Review listing' };

export default async function AdminEventsReviewPage({ params }: PageProps<'/admin/events/[id]'>) {
  return <AdminExperienceReview kind="EVENT" id={(await params).id} />;
}
