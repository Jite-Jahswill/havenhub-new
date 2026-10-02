import type { AgentBookingListItem, Paginated } from '@havenhub/shared';
import { formatKobo } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Filters } from '@/components/admin/filters';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { BookingStatusBadge, EarningStatusBadge } from '@/components/dashboard/status-badge';
import { serverApi } from '@/lib/api/server';
import { formatStay } from '@/lib/format';
import { BOOKING_STATUS_LABELS } from '@/lib/labels';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Bookings' };

const STATUSES = Object.entries(BOOKING_STATUS_LABELS);
const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);

export default async function AgentBookingsPage({ searchParams }: PageProps<'/agent/bookings'>) {
  await requireUser('AGENT', '/agent/bookings');
  const sp = await searchParams;
  const params = { status: str(sp.status), page: str(sp.page) };
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const res = await serverApi<Paginated<AgentBookingListItem>>(`/agents/me/bookings?${query}`);

  return (
    <>
      <PageHeader title="Bookings" description="Reservations on your properties." />
      <Filters
        searchable={false}
        select={{ name: 'status', label: 'Status', value: params.status, options: STATUSES }}
      />
      <Table caption="Bookings">
        <thead>
          <tr>
            <Th>Booking</Th>
            <Th>Dates</Th>
            <Th className="text-right">Your payout</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {(!res.success || res.data.items.length === 0) && (
            <EmptyRow colSpan={4}>{res.success ? 'No bookings yet.' : res.message}</EmptyRow>
          )}
          {res.success &&
            res.data.items.map((b) => (
              <Tr key={b.id} className="hover:bg-surface-secondary/60">
                <Td>
                  <Link href={`/agent/bookings/${b.id}`} className="font-medium hover:underline">
                    {b.property.title}
                  </Link>
                  <p className="text-xs text-text-muted">
                    {b.customerName} · <span className="font-mono">{b.reference}</span>
                  </p>
                </Td>
                <Td className="whitespace-nowrap text-text-secondary">
                  {formatStay(b.startDate, b.endDate)}
                </Td>
                <Td className="text-right tabular-nums">{formatKobo(b.payoutKobo)}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    <BookingStatusBadge status={b.status} />
                    {b.earningStatus && <EarningStatusBadge status={b.earningStatus} />}
                  </div>
                </Td>
              </Tr>
            ))}
        </tbody>
      </Table>
      {res.success && <Pagination page={res.data} basePath="/agent/bookings" params={params} />}
    </>
  );
}
