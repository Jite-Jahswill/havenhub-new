import type { AdminPropertyListItem, Paginated } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Filters } from '@/components/admin/filters';
import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { PropertyStatusBadge } from '@/components/dashboard/status-badge';
import { Photo } from '@/components/properties/photo';
import { serverApi } from '@/lib/api/server';
import { formatPrice } from '@/lib/format';
import { PROPERTY_STATUS_LABELS, PROPERTY_TYPE_LABELS } from '@/lib/labels';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Properties' };

const STATUSES = (
  ['PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'SUSPENDED', 'DRAFT', 'ARCHIVED'] as const
).map((s): [string, string] => [s, PROPERTY_STATUS_LABELS[s]]);
const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);

export default async function AdminPropertiesPage({
  searchParams,
}: PageProps<'/admin/properties'>) {
  await requireUser('ADMIN', '/admin/properties');
  const sp = await searchParams;
  const params = { search: str(sp.search), status: str(sp.status), page: str(sp.page) };
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const res = await serverApi<Paginated<AdminPropertyListItem>>(`/admin/properties?${query}`);
  const date = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' });

  return (
    <>
      <PageHeader title="Properties" description="Moderate listings before they go live." />
      {!res.success ? (
        <NoAccess />
      ) : (
        <>
          <nav aria-label="Quick filters" className="mb-4 flex flex-wrap gap-2 text-sm">
            <Link
              href="/admin/properties?status=PENDING_REVIEW"
              aria-current={params.status === 'PENDING_REVIEW' ? 'page' : undefined}
              className="rounded-full border border-border px-3.5 py-1.5 font-medium text-text hover:bg-surface-secondary aria-[current=page]:bg-surface-inverse aria-[current=page]:text-text-inverse"
            >
              Moderation queue
            </Link>
            <Link
              href="/admin/properties"
              aria-current={!params.status ? 'page' : undefined}
              className="rounded-full border border-border px-3.5 py-1.5 font-medium text-text hover:bg-surface-secondary aria-[current=page]:bg-surface-inverse aria-[current=page]:text-text-inverse"
            >
              All listings
            </Link>
          </nav>
          <Filters
            search={params.search}
            select={{ name: 'status', label: 'Status', value: params.status, options: STATUSES }}
          />
          <Table caption="Properties">
            <thead>
              <tr>
                <Th>Listing</Th>
                <Th>Agent</Th>
                <Th>{params.status === 'PENDING_REVIEW' ? 'Submitted' : 'Updated'}</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.length === 0 && (
                <EmptyRow colSpan={4}>
                  {params.status === 'PENDING_REVIEW'
                    ? 'Nothing waiting for review. 🎉'
                    : 'No properties match these filters.'}
                </EmptyRow>
              )}
              {res.data.items.map((p) => (
                <Tr key={p.id} className="hover:bg-surface-secondary/60">
                  <Td>
                    <div className="flex items-center gap-3">
                      <div className="relative size-12 shrink-0 overflow-hidden rounded-control bg-surface-secondary">
                        {p.coverImage && (
                          <Photo src={p.coverImage.thumbnailUrl} alt="" sizes="48px" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <Link
                          href={`/admin/properties/${p.id}`}
                          className="font-medium hover:underline"
                        >
                          {p.title}
                        </Link>
                        <p className="text-xs text-text-muted">
                          {PROPERTY_TYPE_LABELS[p.propertyType]}
                          {p.city ? ` · ${p.city}` : ''}
                          {p.priceKobo ? ` · ${formatPrice(p.priceKobo, p.pricingPeriod)}` : ''}
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <p>{p.agent.displayName}</p>
                    <p className="text-xs text-text-muted">{p.agent.email}</p>
                  </Td>
                  <Td className="whitespace-nowrap text-text-secondary">
                    {date.format(
                      new Date(
                        params.status === 'PENDING_REVIEW' && p.submittedAt
                          ? p.submittedAt
                          : p.updatedAt,
                      ),
                    )}
                  </Td>
                  <Td>
                    <PropertyStatusBadge status={p.status} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={res.data} basePath="/admin/properties" params={params} />
        </>
      )}
    </>
  );
}
