import type { BookingSummary, Paginated } from '@havenhub/shared';
import { formatKobo } from '@havenhub/shared';
import { Card, buttonClasses } from '@havenhub/ui';
import { CalendarCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Pagination } from '@/components/admin/pagination';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { BookingStatusBadge } from '@/components/dashboard/status-badge';
import { Photo } from '@/components/properties/photo';
import { serverApi } from '@/lib/api/server';
import { formatStay } from '@/lib/format';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Bookings' };

export default async function CustomerBookingsPage({
  searchParams,
}: PageProps<'/account/bookings'>) {
  await requireUser('CUSTOMER', '/account/bookings');
  const sp = await searchParams;
  const page = typeof sp.page === 'string' ? sp.page : '1';
  const res = await serverApi<Paginated<BookingSummary>>(
    `/bookings?page=${encodeURIComponent(page)}&pageSize=10`,
  );

  return (
    <>
      <PageHeader title="Bookings" description="Your stays and rentals." />
      {!res.success ? (
        <Card className="p-6 text-text-secondary">{res.message}</Card>
      ) : res.data.items.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-16 text-center">
          <CalendarCheck aria-hidden className="size-8 text-text-muted" strokeWidth={1.6} />
          <h2 className="mt-4 font-semibold text-text">No bookings yet</h2>
          <p className="mt-2 max-w-sm text-sm text-text-secondary">
            When you reserve a place, it will appear here.
          </p>
          <Link href="/properties" className={buttonClasses({ className: 'mt-6' })}>
            Explore places
          </Link>
        </Card>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {res.data.items.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/account/bookings/${b.id}`}
                  className="block rounded-card focus-visible:outline-2"
                >
                  <Card className="flex items-center gap-4 p-4 transition-colors hover:bg-surface-secondary/60">
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-control bg-surface-secondary sm:size-20">
                      {b.property.coverThumbnailUrl && (
                        <Photo src={b.property.coverThumbnailUrl} alt="" sizes="80px" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-text">{b.property.title}</p>
                      <p className="text-sm text-text-secondary">
                        {formatStay(b.startDate, b.endDate)}
                      </p>
                      <p className="mt-1 text-xs text-text-muted">
                        {b.reference} · {formatKobo(b.totalKobo)}
                      </p>
                    </div>
                    <BookingStatusBadge status={b.status} />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={res.data} basePath="/account/bookings" params={{}} />
        </>
      )}
    </>
  );
}
