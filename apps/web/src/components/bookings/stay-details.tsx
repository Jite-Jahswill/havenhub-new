import { stayUnitLabel, type BookingPropertySnapshot, type BookingSummary } from '@havenhub/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Photo } from '@/components/properties/photo';
import { formatDay } from '@/lib/format';

/** What was booked, from the booking's own snapshot (not the live listing). */
export function StayDetails({
  booking,
  snapshot,
  guests,
  cleaningSelected,
  children,
}: {
  booking: BookingSummary;
  snapshot: BookingPropertySnapshot;
  guests: number | null;
  cleaningSelected: boolean;
  children?: ReactNode;
}) {
  const daily = booking.pricingPeriod === 'DAILY';
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <div className="relative size-20 shrink-0 overflow-hidden rounded-control bg-surface-secondary">
          {snapshot.coverThumbnailUrl && (
            <Photo src={snapshot.coverThumbnailUrl} alt="" sizes="80px" />
          )}
        </div>
        <div className="min-w-0">
          <Link
            href={`/properties/${snapshot.slug}`}
            className="font-semibold text-text hover:underline"
          >
            {snapshot.title}
          </Link>
          <p className="text-sm text-text-secondary">
            {[snapshot.addressLine, snapshot.city, snapshot.state].filter(Boolean).join(', ')}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <Item label={daily ? 'Check-in' : 'Move-in'}>{formatDay(booking.startDate)}</Item>
        <Item label={daily ? 'Check-out' : 'Ends'}>{formatDay(booking.endDate)}</Item>
        <Item label="Length">{stayUnitLabel(booking.pricingPeriod, booking.quantity)}</Item>
        {guests !== null && <Item label="Guests">{guests}</Item>}
        <Item label="Cleaning">
          {cleaningSelected
            ? 'Added'
            : snapshot.cleaningOption === 'INCLUDED'
              ? 'Included'
              : 'Not added'}
        </Item>
        <Item label="Reference">
          <span className="font-mono">{booking.reference}</span>
        </Item>
        {children}
      </dl>
    </div>
  );
}

export function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-text">{children}</dd>
    </div>
  );
}
