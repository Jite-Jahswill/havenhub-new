import type { Metadata } from 'next';
import Link from 'next/link';

import { CampaignEditor } from '@/components/admin/cms/campaign-editor';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { getSite } from '@/lib/cms';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'New campaign' };

export default async function NewCampaignPage() {
  const user = await requireUser('ADMIN', '/admin/email-marketing');
  if (!hasPermission(user, 'marketing.campaigns')) return <NoAccess />;
  const site = await getSite();
  return (
    <>
      <Link href="/admin/email-marketing" className="text-sm text-text-secondary hover:text-text">
        ← Email marketing
      </Link>
      <div className="mt-4">
        <PageHeader title={'New campaign'} />
      </div>
      <CampaignEditor
        campaign={null}
        mediaBase={site.mediaBase}
        canSend={hasPermission(user, 'marketing.send')}
        canUpload={hasPermission(user, 'content.media')}
      />
    </>
  );
}
