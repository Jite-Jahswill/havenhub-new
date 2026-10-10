import type { AgentBookingListItem, AgentEarningsSummary, Paginated } from '@havenhub/shared';
import { formatKobo } from '@havenhub/shared';
import { Alert, Card, CardBody, CardHeader } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { MoneyRows } from '@/components/bookings/money-rows';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { Stat } from '@/components/dashboard/stat';
import { EarningStatusBadge } from '@/components/dashboard/status-badge';
import { serverApi, serverApiData } from '@/lib/api/server';
import { formatStay } from '@/lib/format';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Earnings' };

export default async function AgentEarningsPage() {
  await requireUser('AGENT', '/agent/earnings');
  const [res, recent] = await Promise.all([
    serverApi<AgentEarningsSummary>('/agents/me/earnings'),
    serverApiData<Paginated<AgentBookingListItem>>('/agents/me/bookings?pageSize=50'),
  ]);
  const paid = (recent?.items ?? []).filter((b) => b.earningStatus);

  return (
    <>
      <PageHeader title="Earnings" description="What you have earned from paid bookings." />
      {!res.success ? (
        <Alert tone="error">{res.message}</Alert>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              label="Payable"
              value={formatKobo(res.data.availableKobo)}
              hint="Stays that have started"
            />
            <Stat
              label="Pending"
              value={formatKobo(res.data.pendingKobo)}
              hint="Paid, stay not started yet"
            />
            <Stat
              label="Refunded"
              value={formatKobo(res.data.reversedKobo)}
              hint="Reversed by refunds"
            />
          </div>
          <Alert>
            Withdrawals to your bank account arrive in a later update. Nothing has been paid out
            yet.
          </Alert>
          <div className="grid gap-6 lg:grid-cols-[1fr_380px] [&>*]:min-w-0">
            <Card>
              <CardHeader title="Paid bookings" />
              <CardBody>
                {paid.length === 0 ? (
                  <p className="text-sm text-text-secondary">No paid bookings yet.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {paid.map((b) => (
                      <li
                        key={b.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-3"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/agent/bookings/${b.id}`}
                            className="font-medium text-text hover:underline"
                          >
                            {b.property.title}
                          </Link>
                          <p className="text-xs text-text-muted">
                            {formatStay(b.startDate, b.endDate)}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="tabular-nums">{formatKobo(b.payoutKobo)}</span>
                          {b.earningStatus && <EarningStatusBadge status={b.earningStatus} />}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Totals" description={`${res.data.paidBookings} paid booking(s)`} />
              <CardBody>
                <MoneyRows
                  rows={[
                    {
                      label: 'Booking revenue',
                      kobo: res.data.grossKobo,
                      hint: res.data.agencyFeeKobo
                        ? 'Stays, cleaning and agency fees'
                        : 'Stays and cleaning',
                    },
                    { label: 'HavenHub commission', kobo: res.data.commissionKobo, negative: true },
                    {
                      label: 'Your earnings',
                      kobo: res.data.grossKobo - res.data.commissionKobo,
                      strong: true,
                    },
                    { label: 'Refunded', kobo: res.data.reversedKobo, negative: true },
                    {
                      label: 'VAT collected by HavenHub',
                      kobo: res.data.vatKobo,
                      hint: 'Not part of your payout',
                    },
                  ]}
                />
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
