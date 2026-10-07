import type { Metadata } from 'next';
import Link from 'next/link';

import { BadgeForm } from '@/components/admin/badges/badge-form';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'New badge' };

export default async function NewBadgePage() {
  const user = await requireUser('ADMIN', '/admin/badges/new');
  if (!hasPermission(user, 'badges.manage')) return <NoAccess />;
  return (
    <>
      <Link href="/admin/badges" className="text-sm text-text-secondary hover:text-text">
        ← Badges
      </Link>
      <div className="mt-4">
        <PageHeader
          title="New badge"
          description="For “Award winning”, choose automatic with 5 stars and the number of completed stays you want."
        />
      </div>
      <BadgeForm badge={null} canUpload={hasPermission(user, 'content.media')} />
    </>
  );
}
