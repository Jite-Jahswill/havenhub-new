import type { Metadata } from 'next';
import Link from 'next/link';

import { PageEditor } from '@/components/admin/cms/page-editor';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { getSite } from '@/lib/cms';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'New page' };

export default async function NewPagePage() {
  const user = await requireUser('ADMIN', '/admin/pages/new');
  if (!hasPermission(user, 'content.pages')) return <NoAccess />;
  const site = await getSite();
  return (
    <>
      <Link href="/admin/pages" className="text-sm text-text-secondary hover:text-text">
        ← Pages
      </Link>
      <div className="mt-4">
        <PageHeader title="New page" description="Saved as a draft until you publish it." />
      </div>
      <PageEditor
        page={null}
        mediaBase={site.mediaBase}
        canUpload={hasPermission(user, 'content.media')}
      />
    </>
  );
}
