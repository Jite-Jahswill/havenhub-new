import type { PlatformSettingsView } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { NoAccess } from '@/components/admin/no-access';
import { ModerationForm } from '@/components/admin/platform/platform-forms';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Moderation policy' };

export default async function ModerationPolicyPage() {
  await requireUser('ADMIN', '/admin/settings/moderation');
  const res = await serverApi<PlatformSettingsView>('/admin/settings/moderation');
  return (
    <>
      <Link href="/admin/settings" className="text-sm text-text-secondary hover:text-text">
        ← Settings
      </Link>
      <div className="mt-4">
        <PageHeader title="Moderation policy" />
      </div>
      {res.success ? <ModerationForm settings={res.data} /> : <NoAccess />}
    </>
  );
}
