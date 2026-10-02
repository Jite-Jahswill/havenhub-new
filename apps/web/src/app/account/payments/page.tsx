import type { BookingSummary, Paginated } from '@havenhub/shared';
import { formatKobo } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { PaymentStatusBadge } from '@/components/dashboard/status-badge';
import { serverApi } from '@/lib/api/server';
import { formatMoment } from '@/lib/format';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Payments' };

/** Payment status per booking; receipts and refunds live on each booking. */
export default async function CustomerPaymentsPage({
  searchParams,
}: PageProps<'/account/payments'>) {
  await requireUser('CUSTOMER', '/account/payments');
  const sp = await searchParams;
  const page = typeof sp.page === 'string' ? sp.page : '1';
  const res = await serverApi<Paginated<BookingSummary>>(
    `/bookings?page=${encodeURIComponent(page)}&pageSize=20`,
  );
  const items = res.success ? res.data.items.filter((b) => b.paymentStatus) : [];

  return (
    <>
      <PageHeader title="Payments" description="Payments and refunds for your bookings." />
      <Table caption="Payments">
        <thead>
          <tr>
            <Th>Booking</Th>
            <Th>Booked</Th>
            <Th className="text-right">Amount</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && <EmptyRow colSpan={4}>No payments yet.</EmptyRow>}
          {items.map((b) => (
            <Tr key={b.id}>
              <Td>
                <Link href={`/account/bookings/${b.id}`} className="font-medium hover:underline">
                  {b.property.title}
                </Link>
                <p className="font-mono text-xs text-text-muted">{b.reference}</p>
              </Td>
              <Td className="whitespace-nowrap text-text-secondary">{formatMoment(b.createdAt)}</Td>
              <Td className="text-right tabular-nums">{formatKobo(b.totalKobo)}</Td>
              <Td>{b.paymentStatus && <PaymentStatusBadge status={b.paymentStatus} />}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {res.success && <Pagination page={res.data} basePath="/account/payments" params={{}} />}
    </>
  );
}
