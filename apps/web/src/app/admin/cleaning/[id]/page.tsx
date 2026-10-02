import type { Metadata } from 'next';

import { AdminExperienceReview } from '@/components/admin/experience-admin';

export const metadata: Metadata = { title: 'Review listing' };

export default async function AdminCleaningReviewPage({
  params,
}: PageProps<'/admin/cleaning/[id]'>) {
  return <AdminExperienceReview kind="CLEANING" id={(await params).id} />;
}
