import {
  EXPERIENCE_KINDS,
  EXPERIENCE_KIND_LABELS,
  type AgentExperienceList,
  type ExperienceKind,
} from '@havenhub/shared';
import { Alert, Card, buttonClasses } from '@havenhub/ui';
import { Plus, Ticket } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { PropertyStatusBadge } from '@/components/dashboard/status-badge';
import { Photo } from '@/components/properties/photo';
import { serverApi } from '@/lib/api/server';
import { formatEventTime } from '@/lib/experiences';
import { formatLimit } from '@/lib/format';

export const metadata: Metadata = { title: 'Experiences' };

const isKind = (v: unknown): v is ExperienceKind =>
  typeof v === 'string' && (EXPERIENCE_KINDS as readonly string[]).includes(v);

export default async function AgentExperiencesPage({
  searchParams,
}: PageProps<'/agent/experiences'>) {
  const { kind: raw } = await searchParams;
  const kind: ExperienceKind = isKind(raw) ? raw : 'EVENT';
  const res = await serverApi<AgentExperienceList>(`/agents/me/experiences?kind=${kind}`);
  const labels = EXPERIENCE_KIND_LABELS[kind];
  const allowance = res.success ? res.data.allowances[kind] : null;
  const atLimit = allowance && allowance.limit !== null && allowance.used >= allowance.limit;

  return (
    <>
      <PageHeader
        title="Experiences"
        description="Events, tours, hotels and cleaning services. Listings are reviewed before they go live; ticket sales and bookings come later."
      />
      <nav aria-label="Listing type" className="mb-6 flex flex-wrap gap-2 text-sm">
        {EXPERIENCE_KINDS.map((k) => (
          <Link
            key={k}
            href={`/agent/experiences?kind=${k}`}
            aria-current={k === kind ? 'page' : undefined}
            className="rounded-full border border-border px-3.5 py-1.5 font-medium text-text hover:bg-surface-secondary aria-[current=page]:bg-surface-inverse aria-[current=page]:text-text-inverse"
          >
            {EXPERIENCE_KIND_LABELS[k].many}
          </Link>
        ))}
      </nav>

      {!res.success ? (
        <Alert tone="error">{res.message}</Alert>
      ) : (
        <>
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-text-secondary">
              {allowance
                ? allowance.limit === 0
                  ? `${labels.many} are not included in your plan.`
                  : `${allowance.used} of ${formatLimit(allowance.limit).toLowerCase()} active ${labels.many.toLowerCase()} on your plan.`
                : 'Posting cleaning services is free and unlimited.'}
            </p>
            {atLimit ? (
              <Link href="/agent/subscription/plans" className={buttonClasses()}>
                {allowance.limit === 0 ? 'View plans' : 'Upgrade to add more'}
              </Link>
            ) : (
              <Link href={`/agent/experiences/new?kind=${kind}`} className={buttonClasses()}>
                <Plus aria-hidden className="size-4" /> Add {labels.one.toLowerCase()}
              </Link>
            )}
          </div>

          {res.data.items.length === 0 ? (
            <Card className="flex flex-col items-center px-6 py-16 text-center">
              <span className="grid size-14 place-items-center rounded-full bg-surface-secondary text-text-secondary">
                <Ticket aria-hidden className="size-6" strokeWidth={1.6} />
              </span>
              <h2 className="mt-6 text-lg font-semibold text-text">
                No {labels.many.toLowerCase()} yet
              </h2>
              <p className="mt-2 max-w-sm text-text-secondary">
                Save a draft and finish it later. It goes live after a quick review.
              </p>
            </Card>
          ) : (
            <ul className="flex flex-col gap-4">
              {res.data.items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/agent/experiences/${item.id}`}
                    className="flex gap-4 rounded-card border border-border bg-surface p-4 shadow-card transition-colors hover:bg-surface-secondary sm:gap-6"
                  >
                    <div className="relative aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-control bg-surface-secondary sm:w-36">
                      {item.coverImage && (
                        <Photo src={item.coverImage.thumbnailUrl} alt="" sizes="144px" />
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <PropertyStatusBadge status={item.status} />
                      <h2 className="truncate font-semibold text-text">{item.title}</h2>
                      <p className="truncate text-sm text-text-secondary">
                        {[item.city, item.state].filter(Boolean).join(', ') || 'Location not set'}
                        {item.startsAt ? ` · ${formatEventTime(item.startsAt)}` : ''}
                      </p>
                      {item.status === 'REJECTED' && item.moderationNote && (
                        <p className="line-clamp-1 text-sm text-error">
                          Changes requested: {item.moderationNote}
                        </p>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
