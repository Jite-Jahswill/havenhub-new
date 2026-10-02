import type { AdminVacationZoneListItem, Paginated } from '@havenhub/shared';
import { Badge, buttonClasses } from '@havenhub/ui';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Filters } from '@/components/admin/filters';
import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { Photo } from '@/components/properties/photo';
import { serverApi } from '@/lib/api/server';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Destinations' };
const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);

export default async function AdminDestinationsPage({
  searchParams,
}: PageProps<'/admin/destinations'>) {
  await requireUser('ADMIN', '/admin/destinations');
  const sp = await searchParams;
  const params = { search: str(sp.search), page: str(sp.page) };
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const res = await serverApi<Paginated<AdminVacationZoneListItem>>(
    `/admin/vacation-zones?${query}`,
  );
  const date = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' });

  return (
    <>
      <PageHeader
        title="Destinations"
        description="Vacation zones shown on the public Destinations page."
        action={
          res.success ? (
            <Link href="/admin/destinations/new" className={buttonClasses()}>
              <Plus aria-hidden className="size-4" /> New destination
            </Link>
          ) : undefined
        }
      />
      {!res.success ? (
        <NoAccess />
      ) : (
        <>
          <Filters search={params.search} placeholder="Search by name or state" />
          <Table caption="Destinations">
            <thead>
              <tr>
                <Th>Destination</Th>
                <Th>Featured</Th>
                <Th>Updated</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.length === 0 && <EmptyRow colSpan={4}>No destinations yet.</EmptyRow>}
              {res.data.items.map((z) => (
                <Tr key={z.id} className="hover:bg-surface-secondary/60">
                  <Td>
                    <div className="flex items-center gap-3">
                      <div className="relative size-12 shrink-0 overflow-hidden rounded-control bg-surface-secondary">
                        {z.coverImage && (
                          <Photo src={z.coverImage.thumbnailUrl} alt="" sizes="48px" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <Link
                          href={`/admin/destinations/${z.id}`}
                          className="font-medium hover:underline"
                        >
                          {z.name}
                        </Link>
                        <p className="text-xs text-text-muted">{z.state ?? '—'}</p>
                      </div>
                    </div>
                  </Td>
                  <Td className="text-text-secondary">{z.experienceCount}</Td>
                  <Td className="whitespace-nowrap text-text-secondary">
                    {date.format(new Date(z.updatedAt))}
                  </Td>
                  <Td>
                    <Badge tone={z.published ? 'success' : 'neutral'}>
                      {z.published ? 'Published' : 'Draft'}
                    </Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={res.data} basePath="/admin/destinations" params={params} />
        </>
      )}
    </>
  );
}
