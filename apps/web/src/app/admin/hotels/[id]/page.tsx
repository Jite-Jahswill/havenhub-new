import type { Metadata } from 'next';

import { AdminExperienceReview } from '@/components/admin/experience-admin';

export const metadata: Metadata = { title: 'Review listing' };

export default async function AdminHotelsReviewPage({ params }: PageProps<'/admin/hotels/[id]'>) {
  return <AdminExperienceReview kind="HOTEL" id={(await params).id} />;
}
