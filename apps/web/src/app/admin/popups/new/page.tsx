import type { Metadata } from 'next';
import Link from 'next/link';

import { NoAccess } from '@/components/admin/no-access';
import { PopupForm } from '@/components/admin/popups/popup-form';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'New pop-up' };

export default async function NewPopupPage() {
  const user = await requireUser('ADMIN', '/admin/popups/new');
  if (!hasPermission(user, 'popups.manage')) return <NoAccess />;
  return (
    <>
      <Link href="/admin/popups" className="text-sm text-text-secondary hover:text-text">
        ← Pop-ups
      </Link>
      <div className="mt-4">
        <PageHeader
          title="New pop-up"
          description="It is saved switched off until you tick Live."
        />
      </div>
      <PopupForm popup={null} canUpload={hasPermission(user, 'content.media')} />
    </>
  );
}
