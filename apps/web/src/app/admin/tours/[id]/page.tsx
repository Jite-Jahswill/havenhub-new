import type { Metadata } from 'next';

import { AdminExperienceReview } from '@/components/admin/experience-admin';

export const metadata: Metadata = { title: 'Review listing' };

export default async function AdminToursReviewPage({ params }: PageProps<'/admin/tours/[id]'>) {
  return <AdminExperienceReview kind="TOUR" id={(await params).id} />;
}
