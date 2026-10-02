import {
  EXPERIENCE_KIND_LABELS,
  EXPERIENCE_LIMITS,
  type AgentExperienceView,
  type AgentProfileView,
  type AmenityView,
} from '@havenhub/shared';
import { Alert } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ExperienceForm } from '@/components/agent-experiences/experience-form';
import { ExperienceStatusPanel } from '@/components/agent-experiences/experience-status-panel';
import { HotelRoomsManager } from '@/components/agent-experiences/hotel-rooms-manager';
import { TicketTypesEditor } from '@/components/agent-experiences/ticket-types-editor';
import { TourDatesEditor } from '@/components/agent-experiences/tour-dates-editor';
import { MediaManager } from '@/components/agent-properties/media-manager';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi, serverApiData } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Edit listing' };

export default async function EditExperiencePage({
  params,
  searchParams,
}: PageProps<'/agent/experiences/[id]'>) {
  const { id } = await params;
  const { created } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await serverApi<AgentExperienceView>(`/agents/me/experiences/${id}`);
  if (!res.success) notFound();
  const experience = res.data;
  const [amenities, profile] = await Promise.all([
    serverApiData<AmenityView[]>('/amenities'),
    serverApiData<AgentProfileView>('/agents/me'),
  ]);
  const editable = ['DRAFT', 'REJECTED', 'PUBLISHED'].includes(experience.status);
  const restricted =
    profile?.verificationStatus === 'SUSPENDED' || profile?.verificationStatus === 'BLOCKED';
  const locked = !editable || restricted;
  const labels = EXPERIENCE_KIND_LABELS[experience.kind];

  return (
    <>
      <Link
        href={`/agent/experiences?kind=${experience.kind}`}
        className="text-sm text-text-secondary hover:text-text"
      >
        ← {labels.many}
      </Link>
      <div className="mt-4">
        <PageHeader
          title={experience.title}
          badge={labels.one}
          description={[experience.city, experience.state].filter(Boolean).join(', ') || undefined}
        />
      </div>
      {created === '1' && (
        <Alert tone="success" className="mb-6">
          Draft created. Add photos and the remaining details, then submit for review.
        </Alert>
      )}
      {experience.status === 'PENDING_REVIEW' && (
        <Alert className="mb-6">This listing is being reviewed. Withdraw it to make changes.</Alert>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <MediaManager
            property={experience}
            basePath={`/agents/me/experiences/${experience.id}`}
            limits={{ images: EXPERIENCE_LIMITS.images, videos: EXPERIENCE_LIMITS.videos }}
            limitSource="listing"
            locked={locked}
          />
          {experience.kind === 'EVENT' && (
            <TicketTypesEditor experience={experience} locked={locked} />
          )}
          {experience.kind === 'TOUR' && (
            <TourDatesEditor experience={experience} locked={locked} />
          )}
          {experience.kind === 'HOTEL' && (
            <HotelRoomsManager experience={experience} locked={locked} />
          )}
          <ExperienceForm
            kind={experience.kind}
            experience={experience}
            amenities={amenities ?? []}
            locked={locked}
          />
        </div>
        <aside className="flex flex-col gap-6 xl:sticky xl:top-26 xl:self-start">
          <ExperienceStatusPanel
            experience={experience}
            agentVerified={profile?.verificationStatus === 'VERIFIED'}
          />
        </aside>
      </div>
    </>
  );
}
