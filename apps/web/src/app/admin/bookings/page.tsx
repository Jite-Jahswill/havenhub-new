import type { AdminBookingListItem, Paginated } from '@havenhub/shared';
import { formatKobo } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Filters } from '@/components/admin/filters';
import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { BookingStatusBadge, PaymentStatusBadge } from '@/components/dashboard/status-badge';
import { serverApi } from '@/lib/api/server';
import { formatStay } from '@/lib/format';
import { BOOKING_STATUS_LABELS } from '@/lib/labels';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Bookings' };

const STATUSES = Object.entries(BOOKING_STATUS_LABELS);
const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);

export default async function AdminBookingsPage({ searchParams }: PageProps<'/admin/bookings'>) {
  await requireUser('ADMIN', '/admin/bookings');
  const sp = await searchParams;
  const params = { search: str(sp.search), status: str(sp.status), page: str(sp.page) };
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const res = await serverApi<Paginated<AdminBookingListItem>>(`/admin/bookings?${query}`);

  return (
    <>
      <PageHeader title="Bookings" description="Every reservation, its payment and its status." />
      {!res.success ? (
        <NoAccess />
      ) : (
        <>
          <Filters
            search={params.search}
            placeholder="Search by reference, customer or property"
            select={{ name: 'status', label: 'Status', value: params.status, options: STATUSES }}
          />
          <Table caption="Bookings">
            <thead>
              <tr>
                <Th>Booking</Th>
                <Th>Customer</Th>
                <Th>Dates</Th>
                <Th className="text-right">Total</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.length === 0 && (
                <EmptyRow colSpan={5}>No bookings match these filters.</EmptyRow>
              )}
              {res.data.items.map((b) => (
                <Tr key={b.id} className="hover:bg-surface-secondary/60">
                  <Td>
                    <Link
                      href={`/admin/bookings/${b.id}`}
                      className="font-mono font-medium hover:underline"
                    >
                      {b.reference}
                    </Link>
                    <p className="text-xs text-text-muted">
                      {b.property.title} · {b.agent.displayName}
                    </p>
                  </Td>
                  <Td>
                    <p>{b.customer.fullName}</p>
                    <p className="text-xs text-text-muted">{b.customer.email}</p>
                  </Td>
                  <Td className="whitespace-nowrap text-text-secondary">
                    {formatStay(b.startDate, b.endDate)}
                  </Td>
                  <Td className="text-right tabular-nums">{formatKobo(b.totalKobo)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      <BookingStatusBadge status={b.status} />
                      {b.paymentStatus && <PaymentStatusBadge status={b.paymentStatus} />}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={res.data} basePath="/admin/bookings" params={params} />
        </>
      )}
    </>
  );
}
