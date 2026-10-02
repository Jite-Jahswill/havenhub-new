import type { AdminPropertyDetail } from '@havenhub/shared';
import { Card, CardBody, CardHeader } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { NoAccess } from '@/components/admin/no-access';
import { PropertyModeration } from '@/components/admin/property-moderation';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { PropertyStatusBadge, VerificationBadge } from '@/components/dashboard/status-badge';
import { LocationMapLazy } from '@/components/map/location-map-lazy';
import { Photo } from '@/components/properties/photo';
import { serverApi } from '@/lib/api/server';
import { formatPrice } from '@/lib/format';
import {
  CLEANING_LABELS,
  LISTING_TYPE_LABELS,
  PERIOD_LABELS,
  PROPERTY_TYPE_LABELS,
} from '@/lib/labels';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Review property' };

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-text">{children || '—'}</dd>
    </div>
  );
}

export default async function AdminPropertyPage({ params }: PageProps<'/admin/properties/[id]'>) {
  const user = await requireUser('ADMIN', '/admin/properties');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await serverApi<AdminPropertyDetail>(`/admin/properties/${id}`);
  if (!res.success) {
    if (res.code === 'NOT_FOUND') notFound();
    return <NoAccess />;
  }
  const p = res.data;
  const canModerate = hasPermission(user, 'properties.approve');
  const date = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <>
      <Link
        href="/admin/properties?status=PENDING_REVIEW"
        className="text-sm text-text-secondary hover:text-text"
      >
        ← Moderation queue
      </Link>
      <div className="mt-4">
        <PageHeader
          title={p.title}
          description={[p.addressLine, p.city, p.state].filter(Boolean).join(', ')}
          action={<PropertyStatusBadge status={p.status} />}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title={`Photos (${p.images.length})`} />
            <CardBody>
              {p.images.length ? (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {p.images.map((image) => (
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
              {p.videos.length > 0 && (
                <p className="mt-4 text-sm text-text-secondary">
                  Videos:{' '}
                  {p.videos.map((v) => (
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
              <dl className="grid gap-5 sm:grid-cols-3">
                <Detail label="Type">{PROPERTY_TYPE_LABELS[p.propertyType]}</Detail>
                <Detail label="Purpose">{LISTING_TYPE_LABELS[p.listingType]}</Detail>
                <Detail label="Pricing">{p.pricingPeriod && PERIOD_LABELS[p.pricingPeriod]}</Detail>
                <Detail label="Price">
                  {p.priceKobo !== null && formatPrice(p.priceKobo, p.pricingPeriod)}
                </Detail>
                <Detail label="Caution fee">
                  {p.cautionFeeKobo !== null && formatPrice(p.cautionFeeKobo)}
                </Detail>
                <Detail label="Discount">{p.discountPercent && `${p.discountPercent}%`}</Detail>
                <Detail label="Bedrooms / baths">
                  {p.bedrooms !== null && `${p.bedrooms} / ${p.bathrooms ?? '—'}`}
                </Detail>
                <Detail label="Guests">{p.maxGuests}</Detail>
                <Detail label="Size">{p.sizeSqm && `${p.sizeSqm} m²`}</Detail>
                <Detail label="Cleaning">
                  {p.cleaningOption && CLEANING_LABELS[p.cleaningOption]}
                </Detail>
                <Detail label="LGA">{p.lga}</Detail>
                <Detail label="Amenities">{p.amenities.map((a) => a.name).join(', ')}</Detail>
              </dl>
              <div>
                <h3 className="text-xs text-text-muted">Description</h3>
                <p className="mt-1 text-sm leading-relaxed whitespace-pre-line text-text">
                  {p.description ?? '—'}
                </p>
              </div>
              {p.latitude !== null && p.longitude !== null && (
                <div className="h-64 overflow-hidden rounded-control border border-border">
                  <LocationMapLazy latitude={p.latitude} longitude={p.longitude} />
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-6 xl:sticky xl:top-26 xl:self-start">
          <Card>
            <CardHeader
              title="Moderation"
              description={
                p.submittedAt
                  ? `Submitted ${date.format(new Date(p.submittedAt))}`
                  : 'Not submitted'
              }
            />
            <CardBody className="flex flex-col gap-5">
              {p.moderationNote && (
                <p className="rounded-control bg-surface-secondary px-4 py-3 text-sm">
                  <span className="font-semibold">Last note: </span>
                  {p.moderationNote}
                </p>
              )}
              {canModerate ? (
                <PropertyModeration property={p} />
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
                <Detail label="Name">{p.agent.displayName}</Detail>
                <Detail label="Email">{p.agent.email}</Detail>
                <Detail label="Verification">
                  <VerificationBadge status={p.agent.verificationStatus as never} />
                </Detail>
              </dl>
              {hasPermission(user, 'agents.view') && (
                <Link
                  href={`/admin/agents/${p.agent.id}`}
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
