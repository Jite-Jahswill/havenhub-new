import type { Metadata } from 'next';
import Link from 'next/link';

import { ZoneForm } from '@/components/admin/destinations/zone-form';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'New destination' };

export default async function NewDestinationPage() {
  const user = await requireUser('ADMIN', '/admin/destinations/new');
  if (!hasPermission(user, 'vacation_zones.manage')) return <NoAccess />;
  return (
    <>
      <Link href="/admin/destinations" className="text-sm text-text-secondary hover:text-text">
        ← Destinations
      </Link>
      <div className="mt-4">
        <PageHeader
          title="New destination"
          description="Save it as a draft, then add a cover photo."
        />
      </div>
      <ZoneForm />
    </>
  );
}
