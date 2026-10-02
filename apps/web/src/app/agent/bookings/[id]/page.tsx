import type { AgentBookingDetail } from '@havenhub/shared';
import { Alert, Card, CardBody, CardHeader } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CancelBooking } from '@/components/bookings/booking-actions';
import { MoneyRows } from '@/components/bookings/money-rows';
import { PriceBreakdown } from '@/components/bookings/price-breakdown';
import { Item, StayDetails } from '@/components/bookings/stay-details';
import { StartConversationButton } from '@/components/chat/start-conversation-button';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import {
  BookingStatusBadge,
  EarningStatusBadge,
  PaymentStatusBadge,
  RefundStatusBadge,
} from '@/components/dashboard/status-badge';
import { serverApi } from '@/lib/api/server';
import { formatMoment } from '@/lib/format';
import { CANCELLED_BY_LABELS } from '@/lib/labels';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Booking' };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function AgentBookingPage({ params }: PageProps<'/agent/bookings/[id]'>) {
  const { id } = await params;
  await requireUser('AGENT', `/agent/bookings/${id}`);
  if (!UUID.test(id)) notFound();
  const res = await serverApi<AgentBookingDetail>(`/agents/me/bookings/${id}`);
  if (!res.success) notFound();
  const b = res.data;
  const f = b.financials;

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
            href="/agent/bookings"
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
                <Item label="Customer">{b.customer.fullName}</Item>
                {b.customer.email && <Item label="Email">{b.customer.email}</Item>}
                {b.customer.phone && <Item label="Phone">{b.customer.phone}</Item>}
              </StayDetails>
              {!b.customer.email && (
                <p className="mt-4 text-xs text-text-muted">
                  Contact details are shared once the booking is paid.
                </p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="What the customer pays" description="Fixed when they booked." />
            <CardBody>
              <PriceBreakdown lines={b.lines} totalKobo={b.totalKobo} depositKobo={f.cautionKobo} />
            </CardBody>
          </Card>
        </div>
        <aside className="flex min-w-0 flex-col gap-6">
          <StartConversationButton
            context={{ contextType: 'BOOKING', bookingId: b.id }}
            area="agent"
            label="Message the customer"
          />
          <Card>
            <CardHeader
              title="Your earnings"
              action={f.earningStatus ? <EarningStatusBadge status={f.earningStatus} /> : undefined}
            />
            <CardBody className="flex flex-col gap-4">
              <MoneyRows
                rows={[
                  { label: 'Stay (after listing discount)', kobo: f.stayKobo },
                  ...(f.cleaningKobo ? [{ label: 'Cleaning', kobo: f.cleaningKobo }] : []),
                  { label: 'HavenHub commission', kobo: f.commissionKobo, negative: true },
                  { label: 'Your payout', kobo: f.payoutKobo, strong: true },
                ]}
              />
              <p className="text-xs text-text-muted">
                {f.earningStatus === 'AVAILABLE'
                  ? 'Payable. Withdrawals arrive in a later update.'
                  : f.earningStatus === 'PENDING'
                    ? 'Becomes payable when the stay starts.'
                    : f.earningStatus === 'REVERSED'
                      ? 'Refunded to the customer.'
                      : 'Earned once the customer pays.'}
              </p>
              {(f.vatKobo > 0 || f.cautionKobo > 0) && (
                <p className="text-xs text-text-muted">
                  VAT and the caution deposit are held by HavenHub and are not part of your payout.
                </p>
              )}
            </CardBody>
          </Card>
          {b.cancellation && (
            <Alert>
              Cancelled by {CANCELLED_BY_LABELS[b.cancellation.cancelledBy]} on{' '}
              {formatMoment(b.cancellation.cancelledAt)}
              {b.cancellation.reason ? ` — “${b.cancellation.reason}”` : ''}.
            </Alert>
          )}
          {b.canCancel && (
            <Card>
              <CardHeader
                title="Cancel this booking"
                description="The customer is refunded in full."
              />
              <CardBody>
                <CancelBooking
                  endpoint={`/agents/me/bookings/${b.id}/cancel`}
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
