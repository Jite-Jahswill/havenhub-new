import type { PlatformSettingsView } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { NoAccess } from '@/components/admin/no-access';
import { MaintenanceForm } from '@/components/admin/platform/platform-forms';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Maintenance mode' };

export default async function MaintenancePage() {
  await requireUser('ADMIN', '/admin/settings/maintenance');
  const res = await serverApi<PlatformSettingsView>('/admin/settings/maintenance');
  return (
    <>
      <Link href="/admin/settings" className="text-sm text-text-secondary hover:text-text">
        ← Settings
      </Link>
      <div className="mt-4">
        <PageHeader title="Maintenance mode" />
      </div>
      {res.success ? <MaintenanceForm settings={res.data} /> : <NoAccess />}
    </>
  );
}
