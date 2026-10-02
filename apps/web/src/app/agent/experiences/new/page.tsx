import {
  EXPERIENCE_KINDS,
  EXPERIENCE_KIND_LABELS,
  type AmenityView,
  type ExperienceKind,
} from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ExperienceForm } from '@/components/agent-experiences/experience-form';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApiData } from '@/lib/api/server';

export const metadata: Metadata = { title: 'New listing' };

export default async function NewExperiencePage({
  searchParams,
}: PageProps<'/agent/experiences/new'>) {
  const { kind } = await searchParams;
  if (typeof kind !== 'string' || !(EXPERIENCE_KINDS as readonly string[]).includes(kind)) {
    redirect('/agent/experiences');
  }
  const k = kind as ExperienceKind;
  const amenities = (await serverApiData<AmenityView[]>('/amenities')) ?? [];
  const one = EXPERIENCE_KIND_LABELS[k].one.toLowerCase();
  return (
    <>
      <Link
        href={`/agent/experiences?kind=${k}`}
        className="text-sm text-text-secondary hover:text-text"
      >
        ← {EXPERIENCE_KIND_LABELS[k].many}
      </Link>
      <div className="mt-4">
        <PageHeader
          title={`Add ${/^[aeiou]/.test(one) ? 'an' : 'a'} ${one}`}
          description="Start with the basics. You’ll add photos and more details on the next step."
        />
      </div>
      <ExperienceForm kind={k} amenities={amenities} />
    </>
  );
}
