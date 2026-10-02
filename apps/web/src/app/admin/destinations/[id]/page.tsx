import type { AdminVacationZoneView } from '@havenhub/shared';
import { Alert, Badge, buttonClasses } from '@havenhub/ui';
import { ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DeleteZone, ZoneCover, ZoneCuration } from '@/components/admin/destinations/zone-media';
import { ZoneForm } from '@/components/admin/destinations/zone-form';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Edit destination' };

export default async function DestinationEditPage({
  params,
  searchParams,
}: PageProps<'/admin/destinations/[id]'>) {
  await requireUser('ADMIN', '/admin/destinations');
  const { id } = await params;
  const { created } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await serverApi<AdminVacationZoneView>(`/admin/vacation-zones/${id}`);
  if (!res.success) {
    if (res.code === 'NOT_FOUND') notFound();
    return <NoAccess />;
  }
  const zone = res.data;
  return (
    <>
      <Link href="/admin/destinations" className="text-sm text-text-secondary hover:text-text">
        ← Destinations
      </Link>
      <div className="mt-4">
        <PageHeader
          title={zone.name}
          description={zone.state ?? undefined}
          action={
            <div className="flex items-center gap-3">
              <Badge tone={zone.published ? 'success' : 'neutral'}>
                {zone.published ? 'Published' : 'Draft'}
              </Badge>
              {zone.published && (
                <Link
                  href={`/destinations/${zone.slug}`}
                  target="_blank"
                  className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                >
                  View <ExternalLink aria-hidden className="size-4" />
                </Link>
              )}
            </div>
          }
        />
      </div>
      {created === '1' && (
        <Alert tone="success" className="mb-6">
          Destination created as a draft. Add a cover photo and publish it when it’s ready.
        </Alert>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <ZoneForm zone={zone} />
          <ZoneCuration zone={zone} />
        </div>
        <aside className="flex flex-col gap-6">
          <ZoneCover zone={zone} />
          <DeleteZone id={zone.id} name={zone.name} />
        </aside>
      </div>
    </>
  );
}
