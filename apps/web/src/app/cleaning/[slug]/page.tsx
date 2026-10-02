import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';

import { ExperienceDetailPage } from '@/components/experiences/experience-detail-page';
import { experienceMetadata, getExperience } from '@/lib/experience-page';
import { experiencePath } from '@/lib/experiences';

export async function generateMetadata({
  params,
}: PageProps<'/cleaning/[slug]'>): Promise<Metadata> {
  return experienceMetadata(await getExperience((await params).slug));
}

export default async function CleaningDetailPage({ params }: PageProps<'/cleaning/[slug]'>) {
  const item = await getExperience((await params).slug);
  if (!item) notFound();
  if (item.kind !== 'CLEANING') permanentRedirect(experiencePath(item.kind, item.slug));
  return <ExperienceDetailPage item={item} />;
}
