import type { AdminBadgeDetail } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BadgeForm, BadgeHolders } from '@/components/admin/badges/badge-form';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Badge' };

export default async function BadgePage({ params }: PageProps<'/admin/badges/[id]'>) {
  const { id } = await params;
  const user = await requireUser('ADMIN', `/admin/badges/${id}`);
  if (!hasPermission(user, 'badges.manage')) return <NoAccess />;
  const res = await serverApi<AdminBadgeDetail>(`/admin/badges/${encodeURIComponent(id)}`);
  if (!res.success) notFound();
  return (
    <>
      <Link href="/admin/badges" className="text-sm text-text-secondary hover:text-text">
        ← Badges
      </Link>
      <div className="mt-4">
        <PageHeader title={res.data.name} />
      </div>
      <div className="flex flex-col gap-10">
        <BadgeForm badge={res.data} canUpload={hasPermission(user, 'content.media')} />
        <BadgeHolders badge={res.data} />
      </div>
    </>
  );
}
