import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';

import { ExperienceDetailPage } from '@/components/experiences/experience-detail-page';
import { experienceMetadata, getExperience } from '@/lib/experience-page';
import { experiencePath } from '@/lib/experiences';

export async function generateMetadata({ params }: PageProps<'/hotels/[slug]'>): Promise<Metadata> {
  return experienceMetadata(await getExperience((await params).slug));
}

export default async function HotelsDetailPage({ params }: PageProps<'/hotels/[slug]'>) {
  const item = await getExperience((await params).slug);
  if (!item) notFound();
  if (item.kind !== 'HOTEL') permanentRedirect(experiencePath(item.kind, item.slug));
  return <ExperienceDetailPage item={item} />;
}
