import type { AdminPopupView } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { NoAccess } from '@/components/admin/no-access';
import { PopupForm } from '@/components/admin/popups/popup-form';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Pop-up' };

export default async function PopupPage({ params }: PageProps<'/admin/popups/[id]'>) {
  const { id } = await params;
  const user = await requireUser('ADMIN', `/admin/popups/${id}`);
  if (!hasPermission(user, 'popups.manage')) return <NoAccess />;
  const res = await serverApi<AdminPopupView>(`/admin/popups/${encodeURIComponent(id)}`);
  if (!res.success) notFound();
  const p = res.data;
  return (
    <>
      <Link href="/admin/popups" className="text-sm text-text-secondary hover:text-text">
        ← Pop-ups
      </Link>
      <div className="mt-4">
        <PageHeader
          title={p.name}
          description={`${p.views} views · ${p.clicks} clicks · ${p.dismissals} closed`}
        />
      </div>
      <PopupForm popup={p} canUpload={hasPermission(user, 'content.media')} />
    </>
  );
}
