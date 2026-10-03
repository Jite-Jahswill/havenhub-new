import type { AdminJobView } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { JobEditor } from '@/components/admin/cms/job-editor';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { getSite } from '@/lib/cms';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Edit job' };

export default async function EditJobPage({ params }: PageProps<'/admin/careers/[id]'>) {
  const user = await requireUser('ADMIN', '/admin/careers');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await serverApi<AdminJobView>(`/admin/careers/jobs/${id}`);
  if (!res.success && res.code === 'NOT_FOUND') notFound();
  if (!res.success) return <NoAccess />;
  const site = await getSite();
  return (
    <>
      <Link href="/admin/careers" className="text-sm text-text-secondary hover:text-text">
        ← Careers
      </Link>
      <div className="mt-4">
        <PageHeader title={res.data.title} />
      </div>
      <JobEditor
        key={res.data.updatedAt}
        job={res.data}
        mediaBase={site.mediaBase}
        canUpload={hasPermission(user, 'content.media')}
      />
    </>
  );
}
