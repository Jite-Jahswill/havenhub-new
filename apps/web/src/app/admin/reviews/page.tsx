import type { AdminReviewView, Paginated } from '@havenhub/shared';
import { Badge } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Filters } from '@/components/admin/filters';
import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { ReviewActions } from '@/components/admin/review-actions';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { Stars } from '@/components/properties/rating';
import { serverApi } from '@/lib/api/server';
import { formatDate } from '@/lib/format';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Reviews' };
const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);

export default async function AdminReviewsPage({ searchParams }: PageProps<'/admin/reviews'>) {
  const user = await requireUser('ADMIN', '/admin/reviews');
  if (!hasPermission(user, 'reviews.moderate')) return <NoAccess />;
  const sp = await searchParams;
  const params = { status: str(sp.status), rating: str(sp.rating), page: str(sp.page) };
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const res = await serverApi<Paginated<AdminReviewView>>(`/admin/reviews?${query}`);
  return (
    <>
      <PageHeader
        title="Reviews"
        description="Guests review a stay after it is completed. Hidden reviews stop counting towards stars and badges."
      />
      <Filters
        searchable={false}
        select={{
          name: 'status',
          label: 'Status',
          value: params.status,
          options: [
            ['PUBLISHED', 'Published'],
            ['HIDDEN', 'Hidden'],
          ],
        }}
        selects={[
          {
            name: 'rating',
            label: 'Stars',
            value: params.rating,
            options: [5, 4, 3, 2, 1].map((n) => [String(n), `${n} stars`] as [string, string]),
          },
        ]}
      />
      {res.success ? (
        <>
          <Table caption="Reviews">
            <thead>
              <tr>
                <Th>Review</Th>
                <Th>Property</Th>
                <Th>Guest</Th>
                <Th>Date</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.length === 0 ? (
                <EmptyRow colSpan={6}>No reviews.</EmptyRow>
              ) : (
                res.data.items.map((r) => (
                  <Tr key={r.id}>
                    <Td className="max-w-md">
                      <Stars value={r.rating} />
                      {r.comment && (
                        <p className="mt-1 line-clamp-3 text-sm text-text-secondary">{r.comment}</p>
                      )}
                      {r.hiddenReason && (
                        <p className="mt-1 text-xs text-text-muted">Hidden: {r.hiddenReason}</p>
                      )}
                    </Td>
                    <Td>
                      <Link href={`/properties/${r.property.slug}`} className="hover:underline">
                        {r.property.title}
                      </Link>
                      <span className="block font-mono text-xs text-text-muted">
                        {r.bookingReference}
                      </span>
                    </Td>
                    <Td>
                      {r.customer.fullName}
                      <span className="block text-xs text-text-muted">{r.customer.email}</span>
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(r.createdAt)}</Td>
                    <Td>
                      {r.status === 'HIDDEN' ? (
                        <Badge>Hidden</Badge>
                      ) : (
                        <Badge tone="success">Published</Badge>
                      )}
                    </Td>
                    <Td>
                      <ReviewActions id={r.id} hidden={r.status === 'HIDDEN'} />
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
          <Pagination page={res.data} basePath="/admin/reviews" params={params} />
        </>
      ) : (
        <NoAccess />
      )}
    </>
  );
}
