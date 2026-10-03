import type { Metadata } from 'next';
import Link from 'next/link';

import { JobEditor } from '@/components/admin/cms/job-editor';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { getSite } from '@/lib/cms';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'New job' };

export default async function NewJobPage() {
  const user = await requireUser('ADMIN', '/admin/careers');
  if (!hasPermission(user, 'careers.manage')) return <NoAccess />;
  const site = await getSite();
  return (
    <>
      <Link href="/admin/careers" className="text-sm text-text-secondary hover:text-text">
        ← Careers
      </Link>
      <div className="mt-4">
        <PageHeader title={'New job'} />
      </div>
      <JobEditor
        job={null}
        mediaBase={site.mediaBase}
        canUpload={hasPermission(user, 'content.media')}
      />
    </>
  );
}
