import type { AdminPageListItem, Paginated } from '@havenhub/shared';
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
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Pages' };
const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);

export default async function AdminPagesPage({ searchParams }: PageProps<'/admin/pages'>) {
  await requireUser('ADMIN', '/admin/pages');
  const sp = await searchParams;
  const params = { search: str(sp.search), status: str(sp.status), page: str(sp.page) };
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const res = await serverApi<Paginated<AdminPageListItem>>(`/admin/cms/pages?${query}`);
  return (
    <>
      <PageHeader
        title="Pages"
        description="About, contact, terms, privacy and your own pages. Only published pages are public."
        action={
          res.success ? (
            <Link href="/admin/pages/new" className={buttonClasses()}>
              <Plus aria-hidden className="size-4" /> New page
            </Link>
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
          <Table caption="Pages">
            <thead>
              <tr>
                <Th>Page</Th>
                <Th>Updated</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.length === 0 && <EmptyRow colSpan={3}>No pages match.</EmptyRow>}
              {res.data.items.map((p) => (
                <Tr key={p.id} className="hover:bg-surface-secondary/60">
                  <Td>
                    <Link href={`/admin/pages/${p.id}`} className="font-medium hover:underline">
                      {p.title}
                    </Link>
                    <p className="text-xs text-text-muted">
                      {p.system ? `/${p.slug} · built-in` : `/pages/${p.slug}`}
                    </p>
                  </Td>
                  <Td className="whitespace-nowrap text-text-secondary">
                    {formatDate(p.updatedAt)}
                  </Td>
                  <Td>
                    <ContentStatusBadge status={p.status} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={res.data} basePath="/admin/pages" params={params} />
        </>
      )}
    </>
  );
}
