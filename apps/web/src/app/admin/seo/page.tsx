import type { AdminSeoSettingsView } from '@havenhub/shared';
import type { Metadata } from 'next';

import { SeoRoutes, SeoSettingsForm } from '@/components/admin/cms/seo-settings-form';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'SEO' };

export default async function AdminSeoPage() {
  const user = await requireUser('ADMIN', '/admin/seo');
  const res = await serverApi<AdminSeoSettingsView>('/admin/cms/seo');
  const canUpload = hasPermission(user, 'content.media');
  return (
    <>
      <PageHeader
        title="SEO"
        description="Search and social defaults, page overrides, robots.txt and sitemap.xml."
      />
      {!res.success ? (
        <NoAccess />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <SeoSettingsForm seo={res.data} canUpload={canUpload} />
          <div className="xl:self-start">
            <SeoRoutes routes={res.data.routes} canUpload={canUpload} />
          </div>
        </div>
      )}
    </>
  );
}
