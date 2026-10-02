import {
  EXPERIENCE_KIND_LABELS,
  TICKET_TYPE_LABELS,
  TOUR_CATEGORY_LABELS,
  WEEKDAY_LABELS,
  formatKobo,
  type AdminExperienceDetail,
  type AdminExperienceListItem,
  type ExperienceKind,
  type Paginated,
} from '@havenhub/shared';
import { Card, CardBody, CardHeader } from '@havenhub/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { NoAccess } from '@/components/admin/no-access';
import { PropertyModeration } from '@/components/admin/property-moderation';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { PropertyStatusBadge, VerificationBadge } from '@/components/dashboard/status-badge';
import { Photo } from '@/components/properties/photo';
import { serverApi } from '@/lib/api/server';
import { KIND_SEGMENT, formatEventTime } from '@/lib/experiences';
import { PROPERTY_STATUS_LABELS } from '@/lib/labels';
import { hasPermission, requireUser } from '@/lib/session';

import { Filters } from './filters';
import { Pagination } from './pagination';
import { EmptyRow, Table, Td, Th, Tr } from './table';

const STATUSES = (
  ['PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'SUSPENDED', 'DRAFT', 'ARCHIVED'] as const
).map((s): [string, string] => [s, PROPERTY_STATUS_LABELS[s]]);
const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);

/** Moderation list of one kind — the property moderation screen, reused. */
export async function AdminExperienceList({
  kind,
  searchParams,
}: {
  kind: ExperienceKind;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const base = `/admin/${KIND_SEGMENT[kind]}`;
  await requireUser('ADMIN', base);
  const params = {
    search: str(searchParams.search),
    status: str(searchParams.status),
    page: str(searchParams.page),
  };
  const query = new URLSearchParams(
    Object.entries({ ...params, kind }).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const res = await serverApi<Paginated<AdminExperienceListItem>>(`/admin/experiences?${query}`);
  const date = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' });
  const label = EXPERIENCE_KIND_LABELS[kind].many;
  const chip =
    'rounded-full border border-border px-3.5 py-1.5 font-medium text-text hover:bg-surface-secondary aria-[current=page]:bg-surface-inverse aria-[current=page]:text-text-inverse';

  return (
    <>
      <PageHeader title={label} description="Review listings before they go live." />
      {!res.success ? (
        <NoAccess />
      ) : (
        <>
          <nav aria-label="Quick filters" className="mb-4 flex flex-wrap gap-2 text-sm">
            <Link
              href={`${base}?status=PENDING_REVIEW`}
              aria-current={params.status === 'PENDING_REVIEW' ? 'page' : undefined}
              className={chip}
            >
              Moderation queue
            </Link>
            <Link href={base} aria-current={!params.status ? 'page' : undefined} className={chip}>
              All listings
            </Link>
          </nav>
          <Filters
            search={params.search}
            placeholder="Search by title, city or agent"
            select={{ name: 'status', label: 'Status', value: params.status, options: STATUSES }}
          />
          <Table caption={label}>
            <thead>
              <tr>
                <Th>Listing</Th>
                <Th>Agent</Th>
                <Th>{params.status === 'PENDING_REVIEW' ? 'Submitted' : 'Updated'}</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.length === 0 && (
                <EmptyRow colSpan={4}>
                  {params.status === 'PENDING_REVIEW'
                    ? 'Nothing waiting for review.'
                    : 'No listings match these filters.'}
                </EmptyRow>
              )}
              {res.data.items.map((item) => (
                <Tr key={item.id} className="hover:bg-surface-secondary/60">
                  <Td>
                    <div className="flex items-center gap-3">
                      <div className="relative size-12 shrink-0 overflow-hidden rounded-control bg-surface-secondary">
                        {item.coverImage && (
                          <Photo src={item.coverImage.thumbnailUrl} alt="" sizes="48px" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <Link href={`${base}/${item.id}`} className="font-medium hover:underline">
                          {item.title}
                        </Link>
                        <p className="text-xs text-text-muted">
                          {[item.city, item.state].filter(Boolean).join(', ') || '—'}
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <p>{item.agent.displayName}</p>
                    <p className="text-xs text-text-muted">{item.agent.email}</p>
                  </Td>
                  <Td className="whitespace-nowrap text-text-secondary">
                    {date.format(
                      new Date(
                        params.status === 'PENDING_REVIEW' && item.submittedAt
                          ? item.submittedAt
                          : item.updatedAt,
                      ),
                    )}
                  </Td>
                  <Td>
                    <PropertyStatusBadge status={item.status} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={res.data} basePath={base} params={params} />
        </>
      )}
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm break-words whitespace-pre-line text-text">
        {children || '—'}
      </dd>
    </div>
  );
}

/** Review page of one listing, with the shared moderation actions. */
export async function AdminExperienceReview({ kind, id }: { kind: ExperienceKind; id: string }) {
  const base = `/admin/${KIND_SEGMENT[kind]}`;
  const user = await requireUser('ADMIN', base);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await serverApi<AdminExperienceDetail>(`/admin/experiences/${id}`);
  if (!res.success) {
    if (res.code === 'NOT_FOUND') notFound();
    return <NoAccess />;
  }
  const x = res.data;
  if (x.kind !== kind) notFound();
  const canModerate = hasPermission(user, 'experiences.approve');
  const date = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <>
      <Link
        href={`${base}?status=PENDING_REVIEW`}
        className="text-sm text-text-secondary hover:text-text"
      >
        ← Moderation queue
      </Link>
      <div className="mt-4">
        <PageHeader
          title={x.title}
          badge={EXPERIENCE_KIND_LABELS[kind].one}
          description={[x.addressLine, x.city, x.state].filter(Boolean).join(', ')}
          action={<PropertyStatusBadge status={x.status} />}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title={`Photos (${x.images.length})`} />
            <CardBody>
              {x.images.length ? (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {x.images.map((image) => (
                    <li
                      key={image.id}
                      className="relative aspect-[4/3] overflow-hidden rounded-control bg-surface-secondary"
                    >
                      <a
                        href={image.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open full-size photo"
                      >
                        <Photo src={image.thumbnailUrl} alt={image.altText ?? ''} sizes="240px" />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-text-secondary">No photos.</p>
              )}
              {x.videos.length > 0 && (
                <p className="mt-4 text-sm text-text-secondary">
                  Videos:{' '}
                  {x.videos.map((v) => (
                    <a
                      key={v.id}
                      href={v.embedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mr-3 font-medium text-primary-text underline"
                    >
                      {v.provider.toLowerCase()} {v.externalId}
                    </a>
                  ))}
                </p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Listing" />
            <CardBody className="flex flex-col gap-6">
              <dl className="grid gap-5 sm:grid-cols-2">
                {x.event && (
                  <>
                    <Detail label="When">
                      {x.event.startsAt && formatEventTime(x.event.startsAt, x.event.endsAt)}
                    </Detail>
                    <Detail label="Organiser">{x.event.organizer}</Detail>
                    <Detail label="Capacity">{x.event.capacity?.toLocaleString('en-NG')}</Detail>
                    <Detail label="Ticket types">
                      {x.event.ticketTypes
                        .map(
                          (t) =>
                            `${t.name} (${TICKET_TYPE_LABELS[t.kind]}) ${formatKobo(t.priceKobo)}`,
                        )
                        .join('\n')}
                    </Detail>
                    <Detail label="Hospitality">{x.event.hospitality}</Detail>
                    <Detail label="Terms">{x.event.terms}</Detail>
                  </>
                )}
                {x.tour && (
                  <>
                    <Detail label="Category">
                      {x.tour.category && TOUR_CATEGORY_LABELS[x.tour.category]}
                    </Detail>
                    <Detail label="Price">
                      {x.tour.priceKobo !== null &&
                        `${formatKobo(x.tour.priceKobo)}${x.tour.priceNote ? ` ${x.tour.priceNote}` : ''}`}
                    </Detail>
                    <Detail label="Group size">{x.tour.capacity}</Detail>
                    <Detail label="Dates">
                      {x.tour.dates.length ? `${x.tour.dates.length} scheduled` : null}
                    </Detail>
                  </>
                )}
                {x.hotel && (
                  <>
                    <Detail label="Room types">
                      {x.hotel.roomTypes
                        .map(
                          (t) =>
                            `${t.name}: ${formatKobo(t.priceKobo)}/night, ${t.roomCount} rooms`,
                        )
                        .join('\n')}
                    </Detail>
                    <Detail label="Food">{x.hotel.food}</Detail>
                    <Detail label="Hospitality">{x.hotel.hospitality}</Detail>
                    <Detail label="Cleaning">{x.hotel.cleaning}</Detail>
                  </>
                )}
                {x.cleaning && (
                  <>
                    <Detail label="Service areas">{x.cleaning.serviceAreas.join(', ')}</Detail>
                    <Detail label="Days">
                      {x.cleaning.availableDays.map((d) => WEEKDAY_LABELS[d]).join(', ')}
                    </Detail>
                    <Detail label="Price">
                      {x.cleaning.priceKobo !== null &&
                        `${formatKobo(x.cleaning.priceKobo)}${x.cleaning.priceNote ? ` ${x.cleaning.priceNote}` : ''}`}
                    </Detail>
                    <Detail label="Availability note">{x.cleaning.availabilityNote}</Detail>
                  </>
                )}
                <Detail label="Amenities">{x.amenities.map((a) => a.name).join(', ')}</Detail>
              </dl>
              <div>
                <h3 className="text-xs text-text-muted">Description</h3>
                <p className="mt-1 text-sm leading-relaxed break-words whitespace-pre-line text-text">
                  {x.description ?? '—'}
                </p>
              </div>
            </CardBody>
          </Card>
        </div>
        <div className="flex flex-col gap-6 xl:sticky xl:top-26 xl:self-start">
          <Card>
            <CardHeader
              title="Moderation"
              description={
                x.submittedAt
                  ? `Submitted ${date.format(new Date(x.submittedAt))}`
                  : 'Not submitted'
              }
            />
            <CardBody className="flex flex-col gap-5">
              {x.moderationNote && (
                <p className="rounded-control bg-surface-secondary px-4 py-3 text-sm break-words">
                  <span className="font-semibold">Last note: </span>
                  {x.moderationNote}
                </p>
              )}
              {canModerate ? (
                <PropertyModeration
                  property={x}
                  endpoint={`/admin/experiences/${x.id}/moderation`}
                />
              ) : (
                <p className="text-sm text-text-secondary">
                  You can view this listing but not moderate it.
                </p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Agent" />
            <CardBody>
              <dl className="flex flex-col gap-4">
                <Detail label="Name">{x.agent.displayName}</Detail>
                <Detail label="Email">{x.agent.email}</Detail>
                <Detail label="Verification">
                  <VerificationBadge status={x.agent.verificationStatus as never} />
                </Detail>
              </dl>
              {hasPermission(user, 'agents.view') && (
                <Link
                  href={`/admin/agents/${x.agent.id}`}
                  className="mt-4 inline-block text-sm font-semibold text-primary-text hover:underline"
                >
                  View agent →
                </Link>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
