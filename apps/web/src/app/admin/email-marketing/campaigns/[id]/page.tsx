import type { AdminCampaignView } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CampaignEditor } from '@/components/admin/cms/campaign-editor';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { getSite } from '@/lib/cms';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Campaign' };

export default async function CampaignPage({
  params,
}: PageProps<'/admin/email-marketing/campaigns/[id]'>) {
  const user = await requireUser('ADMIN', '/admin/email-marketing');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await serverApi<AdminCampaignView>(`/admin/newsletter/campaigns/${id}`);
  if (!res.success && res.code === 'NOT_FOUND') notFound();
  if (!res.success) return <NoAccess />;
  const site = await getSite();
  return (
    <>
      <Link href="/admin/email-marketing" className="text-sm text-text-secondary hover:text-text">
        ← Email marketing
      </Link>
      <div className="mt-4">
        <PageHeader title={res.data.name} />
      </div>
      <CampaignEditor
        key={res.data.updatedAt}
        campaign={res.data}
        mediaBase={site.mediaBase}
        canSend={hasPermission(user, 'marketing.send')}
        canUpload={hasPermission(user, 'content.media')}
      />
    </>
  );
}
