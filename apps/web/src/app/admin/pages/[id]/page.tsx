import type { AdminPageView } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageEditor } from '@/components/admin/cms/page-editor';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { getSite } from '@/lib/cms';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Edit page' };

export default async function EditPagePage({ params }: PageProps<'/admin/pages/[id]'>) {
  const user = await requireUser('ADMIN', '/admin/pages');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [res, site] = await Promise.all([
    serverApi<AdminPageView>(`/admin/cms/pages/${id}`),
    getSite(),
  ]);
  if (!res.success) {
    if (res.code === 'NOT_FOUND') notFound();
    return <NoAccess />;
  }
  return (
    <>
      <Link href="/admin/pages" className="text-sm text-text-secondary hover:text-text">
        ← Pages
      </Link>
      <div className="mt-4">
        <PageHeader title={res.data.title} />
      </div>
      <PageEditor
        key={res.data.updatedAt}
        page={res.data}
        mediaBase={site.mediaBase}
        canUpload={hasPermission(user, 'content.media')}
      />
    </>
  );
}
