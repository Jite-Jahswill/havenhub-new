import type { CmsMediaView, Paginated } from '@havenhub/shared';
import type { Metadata } from 'next';

import { MediaLibrary } from '@/components/admin/cms/media-library';
import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Media' };

export default async function AdminMediaPage({ searchParams }: PageProps<'/admin/media'>) {
  const user = await requireUser('ADMIN', '/admin/media');
  const page = (await searchParams).page;
  const p = typeof page === 'string' && /^\d{1,4}$/.test(page) ? page : '1';
  const res = await serverApi<Paginated<CmsMediaView>>(`/admin/cms/media?page=${p}&pageSize=24`);
  return (
    <>
      <PageHeader
        title="Media"
        description="Images for pages, posts, help articles and the homepage."
      />
      {!res.success ? (
        <NoAccess />
      ) : (
        <>
          <MediaLibrary items={res.data.items} canManage={hasPermission(user, 'content.media')} />
          <Pagination page={res.data} basePath="/admin/media" params={{ page: p }} />
        </>
      )}
    </>
  );
}
