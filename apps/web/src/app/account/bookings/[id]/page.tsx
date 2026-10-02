import { formatKobo, type CustomerBookingDetail } from '@havenhub/shared';
import { Alert, Card, CardBody, CardHeader } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CancelBooking, PayButton, PaymentReturn } from '@/components/bookings/booking-actions';
import { PriceBreakdown } from '@/components/bookings/price-breakdown';
import { StayDetails } from '@/components/bookings/stay-details';
import { StartConversationButton } from '@/components/chat/start-conversation-button';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import {
  BookingStatusBadge,
  PaymentStatusBadge,
  RefundStatusBadge,
} from '@/components/dashboard/status-badge';
import { serverApi } from '@/lib/api/server';
import { formatMoment } from '@/lib/format';
import { CANCELLED_BY_LABELS } from '@/lib/labels';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Booking' };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function CustomerBookingPage({
  params,
  searchParams,
}: PageProps<'/account/bookings/[id]'>) {
  const { id } = await params;
  await requireUser('CUSTOMER', `/account/bookings/${id}`);
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const reference = typeof sp.reference === 'string' ? sp.reference : null;
  const res = await serverApi<CustomerBookingDetail>(`/bookings/${id}`);
  if (!res.success) notFound();
  const b = res.data;

  return (
    <>
      <PageHeader
        title={b.snapshot.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <BookingStatusBadge status={b.status} />
            {b.paymentStatus && <PaymentStatusBadge status={b.paymentStatus} />}
            {b.refund && <RefundStatusBadge status={b.refund.status} />}
          </span>
        }
        action={
          <Link
            href="/account/bookings"
            className="text-sm font-medium text-text-secondary hover:text-text"
          >
            ← All bookings
          </Link>
        }
      />

      {reference && <PaymentReturn reference={reference} />}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Your stay" />
            <CardBody>
              <StayDetails
                booking={b}
                snapshot={b.snapshot}
                guests={b.guests}
                cleaningSelected={b.cleaningSelected}
              />
            </CardBody>
          </Card>

          {b.payments.length > 0 && (
            <Card>
              <CardHeader title="Payments" />
              <CardBody>
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {b.payments.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-3"
                    >
                      <div>
                        <p className="font-mono text-xs text-text-secondary">{p.reference}</p>
                        <p className="text-text-muted">
                          {formatMoment(p.createdAt)}
                          {p.provider === 'TEST' && ' · Test payment (no real money)'}
                        </p>
                        {p.failureReason && <p className="text-xs text-error">{p.failureReason}</p>}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="tabular-nums">{formatKobo(p.amountKobo)}</span>
                        <PaymentStatusBadge status={p.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <StartConversationButton
            context={{ contextType: 'BOOKING', bookingId: b.id }}
            area="account"
            label="Message the agent"
          />
          {b.canPay && (
            <Card>
              <CardHeader
                title="Complete your booking"
                description={
                  b.holdExpiresAt
                    ? `These dates are held for you until ${formatMoment(b.holdExpiresAt)}.`
                    : undefined
                }
              />
              <CardBody>
                <PayButton bookingId={b.id} totalKobo={b.totalKobo} />
              </CardBody>
            </Card>
          )}
          {b.status === 'AWAITING_PAYMENT' && !b.canPay && (
            <Alert tone="warning">The hold on these dates has run out. Please book again.</Alert>
          )}

          <Card>
            <CardHeader title="Price breakdown" description="Fixed when you booked." />
            <CardBody>
              <PriceBreakdown
                lines={b.lines}
                totalKobo={b.totalKobo}
                depositKobo={b.refundableDepositKobo}
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
          {b.refund && (
            <Card>
              <CardHeader title="Refund" />
              <CardBody className="flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="tabular-nums">{formatKobo(b.refund.amountKobo)}</span>
                  <RefundStatusBadge status={b.refund.status} />
                </div>
                <p className="text-text-secondary">{b.refund.reason}</p>
                {b.refund.status === 'REQUESTED' && (
                  <p className="text-xs text-text-muted">
                    HavenHub reviews refunds before they are paid out.
                  </p>
                )}
              </CardBody>
            </Card>
          )}

          {b.canCancel && (
            <Card>
              <CardHeader title="Need to cancel?" />
              <CardBody>
                <CancelBooking
                  endpoint={`/bookings/${b.id}/cancel`}
                  refundKobo={b.cancellationRefundKobo}
                  paid={b.status === 'CONFIRMED'}
                />
              </CardBody>
            </Card>
          )}
          {b.status === 'CONFIRMED' && !b.canCancel && (
            <p className="text-sm text-text-secondary">
              Your stay has started. To change or cancel it, please contact HavenHub support.
            </p>
          )}
        </aside>
      </div>
    </>
  );
}
