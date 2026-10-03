import type { AdminSiteSettingsView } from '@havenhub/shared';
import type { Metadata } from 'next';

import { BrandImages, SiteSettingsForm } from '@/components/admin/cms/site-settings-form';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Site settings' };

export default async function AdminContentPage() {
  await requireUser('ADMIN', '/admin/content');
  const res = await serverApi<AdminSiteSettingsView>('/admin/cms/site');
  return (
    <>
      <PageHeader
        title="Site settings"
        description="Name, logo, contact details, footer and which sections are live."
      />
      {!res.success ? (
        <NoAccess />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <SiteSettingsForm settings={res.data} />
          <div className="xl:sticky xl:top-26 xl:self-start">
            <BrandImages settings={res.data} />
          </div>
        </div>
      )}
    </>
  );
}
