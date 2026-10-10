import type { AdminBookingDetail } from '@havenhub/shared';
import { LEDGER_ENTRY_BUCKET, formatKobo } from '@havenhub/shared';
import { Alert, Card, CardBody, CardHeader } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { NoAccess } from '@/components/admin/no-access';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { CancelBooking } from '@/components/bookings/booking-actions';
import { MoneyRows } from '@/components/bookings/money-rows';
import { PriceBreakdown } from '@/components/bookings/price-breakdown';
import { RefundReview } from '@/components/bookings/refund-review';
import { Item, StayDetails } from '@/components/bookings/stay-details';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import {
  BookingStatusBadge,
  EarningStatusBadge,
  PaymentStatusBadge,
  RefundStatusBadge,
} from '@/components/dashboard/status-badge';
import { serverApi } from '@/lib/api/server';
import { formatMoment } from '@/lib/format';
import { CANCELLED_BY_LABELS, LEDGER_BUCKET_LABELS, LEDGER_LABELS } from '@/lib/labels';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Booking' };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function AdminBookingPage({ params }: PageProps<'/admin/bookings/[id]'>) {
  const { id } = await params;
  const user = await requireUser('ADMIN', `/admin/bookings/${id}`);
  if (!UUID.test(id)) notFound();
  const res = await serverApi<AdminBookingDetail>(`/admin/bookings/${id}`);
  if (!res.success) {
    if (res.code === 'NOT_FOUND') notFound();
    return <NoAccess />;
  }
  const b = res.data;
  const f = b.financials;
  const finance = hasPermission(user, 'payments.view');
  const canRefund = hasPermission(user, 'payments.refund');

  return (
    <>
      <PageHeader
        title={`Booking ${b.reference}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <BookingStatusBadge status={b.status} />
            {b.paymentStatus && <PaymentStatusBadge status={b.paymentStatus} />}
            {b.earningStatus && <EarningStatusBadge status={b.earningStatus} />}
          </span>
        }
        action={
          <Link
            href="/admin/bookings"
            className="text-sm font-medium text-text-secondary hover:text-text"
          >
            ← All bookings
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Stay" />
            <CardBody>
              <StayDetails
                booking={b}
                snapshot={b.snapshot}
                guests={b.guests}
                cleaningSelected={b.cleaningSelected}
              >
                <Item label="Customer">
                  {b.customer.fullName}
                  <span className="block text-xs text-text-muted">{b.customer.email}</span>
                </Item>
                <Item label="Agent">{b.agent.displayName}</Item>
                <Item label="Booked">{formatMoment(b.createdAt)}</Item>
                {b.confirmedAt && <Item label="Confirmed">{formatMoment(b.confirmedAt)}</Item>}
              </StayDetails>
            </CardBody>
          </Card>

          {finance && (
            <>
              <Card>
                <CardHeader title="Payments" />
                <Table caption="Payments">
                  <thead>
                    <tr>
                      <Th>Payment</Th>
                      <Th className="text-right">Amount</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.payments.length === 0 && (
                      <EmptyRow colSpan={3}>No payment attempts.</EmptyRow>
                    )}
                    {b.payments.map((p) => (
                      <Tr key={p.id}>
                        <Td>
                          <p className="font-mono text-xs break-all">{p.reference}</p>
                          <p className="text-xs text-text-muted">{formatMoment(p.createdAt)}</p>
                          <p className="text-xs text-text-muted">
                            {p.provider === 'TEST' ? 'Test provider' : 'Paystack'}
                            {p.failureReason ? ` · ${p.failureReason}` : ''}
                          </p>
                        </Td>
                        <Td className="text-right tabular-nums">{formatKobo(p.amountKobo)}</Td>
                        <Td>
                          <PaymentStatusBadge status={p.status} />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </Card>

              <Card>
                <CardHeader
                  title="Ledger"
                  description="Immutable allocation of the money received and refunded."
                />
                <Table caption="Ledger entries">
                  <thead>
                    <tr>
                      <Th>Entry</Th>
                      <Th>Category</Th>
                      <Th>Source</Th>
                      <Th className="text-right">Amount</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.ledger.length === 0 && (
                      <EmptyRow colSpan={4}>No money recorded yet.</EmptyRow>
                    )}
                    {b.ledger.map((e) => (
                      <Tr key={e.id}>
                        <Td>{LEDGER_LABELS[e.type]}</Td>
                        <Td className="text-xs text-text-muted">
                          {LEDGER_BUCKET_LABELS[LEDGER_ENTRY_BUCKET[e.type]]}
                        </Td>
                        <Td className="text-xs text-text-muted">
                          {e.refundId ? 'Refund' : 'Payment'}
                        </Td>
                        <Td className="text-right tabular-nums">
                          {e.amountKobo < 0
                            ? `−${formatKobo(-e.amountKobo)}`
                            : formatKobo(e.amountKobo)}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                {b.ledgerSummary && b.ledger.length > 0 && (
                  <CardBody>
                    <MoneyRows
                      rows={[
                        { label: 'Customer paid', kobo: b.ledgerSummary.customerPaidKobo },
                        {
                          label: 'Refunded to customer',
                          kobo: b.ledgerSummary.customerRefundedKobo,
                          negative: true,
                        },
                        {
                          label: LEDGER_BUCKET_LABELS.REVENUE,
                          kobo: b.ledgerSummary.revenueKobo,
                          hint: 'Service fee + commission',
                        },
                        {
                          label: LEDGER_BUCKET_LABELS.AGENT_PAYABLE,
                          kobo: b.ledgerSummary.agentPayableKobo,
                        },
                        {
                          label: LEDGER_BUCKET_LABELS.TAX_PAYABLE,
                          kobo: b.ledgerSummary.taxPayableKobo,
                        },
                        {
                          label: LEDGER_BUCKET_LABELS.CAUTION_HELD,
                          kobo: b.ledgerSummary.cautionHeldKobo,
                          hint: 'Customer’s deposit — not revenue',
                        },
                        {
                          label: LEDGER_BUCKET_LABELS.OWED_TO_CUSTOMER,
                          kobo: b.ledgerSummary.owedToCustomerKobo,
                        },
                      ]}
                    />
                  </CardBody>
                )}
              </Card>
            </>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader
              title="Customer price"
              description={`Rates version ${f.pricingConfigVersion}`}
            />
            <CardBody>
              <PriceBreakdown lines={b.lines} totalKobo={b.totalKobo} depositKobo={f.cautionKobo} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Where the money goes" />
            <CardBody>
              <MoneyRows
                rows={[
                  {
                    label: 'Agent payout',
                    kobo: f.agentPayoutKobo,
                    ...(f.agencyFeeKobo ? { hint: 'Includes the agency fee in full' } : {}),
                  },
                  { label: 'HavenHub service fee', kobo: f.serviceFeeKobo },
                  {
                    label: 'HavenHub commission',
                    kobo: f.agentCommissionKobo,
                    hint: 'Deducted from the agent',
                  },
                  { label: 'VAT (for remittance)', kobo: f.vatKobo },
                  { label: 'Caution deposit (held)', kobo: f.cautionKobo },
                  { label: 'Customer total', kobo: b.totalKobo, strong: true },
                ]}
              />
            </CardBody>
          </Card>

          {b.cancellation && (
            <Alert>
              Cancelled by {CANCELLED_BY_LABELS[b.cancellation.cancelledBy]} on{' '}
              {formatMoment(b.cancellation.cancelledAt)}
              {b.cancellation.reason ? ` — “${b.cancellation.reason}”` : ''}.
            </Alert>
          )}

          {finance &&
            b.refunds.map((r) => (
              <Card key={r.id}>
                <CardHeader title="Refund" action={<RefundStatusBadge status={r.status} />} />
                <CardBody className="flex flex-col gap-3 text-sm">
                  <p className="font-semibold tabular-nums">{formatKobo(r.amountKobo)}</p>
                  <p className="text-text-secondary">{r.reason}</p>
                  {r.reviewNote && (
                    <p className="text-text-secondary">Review note: {r.reviewNote}</p>
                  )}
                  {canRefund && ['REQUESTED', 'FAILED', 'PROCESSING'].includes(r.status) && (
                    <RefundReview refundId={r.id} status={r.status} />
                  )}
                </CardBody>
              </Card>
            ))}

          {b.canCancel && canRefund && (
            <Card>
              <CardHeader title="Cancel booking" description="Opens a full refund for review." />
              <CardBody>
                <CancelBooking
                  endpoint={`/admin/bookings/${b.id}/cancel`}
                  refundKobo={b.totalKobo}
                  paid={b.status === 'CONFIRMED'}
                />
              </CardBody>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
