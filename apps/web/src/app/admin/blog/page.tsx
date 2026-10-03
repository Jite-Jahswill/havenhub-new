import type { AdminPostListItem, Paginated } from '@havenhub/shared';
import { buttonClasses } from '@havenhub/ui';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { CONTENT_STATUS_OPTIONS, ContentStatusBadge } from '@/components/admin/cms/content-status';
import { Filters } from '@/components/admin/filters';
import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { formatDate } from '@/lib/format';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Blog' };
const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);

export default async function AdminBlogPage({ searchParams }: PageProps<'/admin/blog'>) {
  const user = await requireUser('ADMIN', '/admin/blog');
  const sp = await searchParams;
  const params = { search: str(sp.search), status: str(sp.status), page: str(sp.page) };
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const res = await serverApi<Paginated<AdminPostListItem>>(`/admin/blog/posts?${query}`);
  return (
    <>
      <PageHeader
        title="Blog"
        description="Write, schedule and publish articles."
        action={
          res.success ? (
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/blog/taxonomy" className={buttonClasses({ variant: 'secondary' })}>
                Categories & tags
              </Link>
              {hasPermission(user, 'blog.create') && (
                <Link href="/admin/blog/new" className={buttonClasses()}>
                  <Plus aria-hidden className="size-4" /> New post
                </Link>
              )}
            </div>
          ) : undefined
        }
      />
      {!res.success ? (
        <NoAccess />
      ) : (
        <>
          <Filters
            search={params.search}
            placeholder="Search by title"
            select={{
              name: 'status',
              label: 'Status',
              value: params.status,
              options: CONTENT_STATUS_OPTIONS,
            }}
          />
          <Table caption="Blog posts">
            <thead>
              <tr>
                <Th>Post</Th>
                <Th>Category</Th>
                <Th>Updated</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.length === 0 && <EmptyRow colSpan={4}>No posts match.</EmptyRow>}
              {res.data.items.map((p) => (
                <Tr key={p.id} className="hover:bg-surface-secondary/60">
                  <Td>
                    <Link href={`/admin/blog/${p.id}`} className="font-medium hover:underline">
                      {p.title}
                    </Link>
                    <p className="text-xs text-text-muted">{p.authorName ?? '—'}</p>
                  </Td>
                  <Td className="text-text-secondary">{p.category?.name ?? '—'}</Td>
                  <Td className="whitespace-nowrap text-text-secondary">
                    {formatDate(p.updatedAt)}
                  </Td>
                  <Td>
                    <ContentStatusBadge status={p.displayStatus} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={res.data} basePath="/admin/blog" params={params} />
        </>
      )}
    </>
  );
}
