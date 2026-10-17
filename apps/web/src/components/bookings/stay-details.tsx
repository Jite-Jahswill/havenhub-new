import {
  addDays,
  stayUnitLabel,
  type BookingPropertySnapshot,
  type BookingSummary,
  type ExperienceSelectionView,
} from '@havenhub/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Photo } from '@/components/properties/photo';
import { formatDay } from '@/lib/format';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What was booked, from the booking's own snapshot (not the live listing). */
export function StayDetails({
  booking,
  snapshot,
  selection = null,
  guests,
  cleaningSelected,
  children,
}: {
  booking: BookingSummary;
  snapshot: BookingPropertySnapshot;
  /** Tour, event and hotel bookings: what was included. */
  selection?: ExperienceSelectionView | null;
  guests: number | null;
  cleaningSelected: boolean;
  children?: ReactNode;
}) {
  const kind = snapshot.kind;
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
          <Link href={snapshot.href} className="font-semibold text-text hover:underline">
            {snapshot.title}
          </Link>
          <p className="text-sm text-text-secondary">
            {[snapshot.addressLine, snapshot.city, snapshot.state].filter(Boolean).join(', ')}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
        {kind === 'PROPERTY' ? (
          <>
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
          </>
        ) : kind === 'HOTEL' ? (
          <>
            <Item label="Check-in">{formatDay(booking.startDate)}</Item>
            <Item label="Check-out">{formatDay(booking.endDate)}</Item>
            <Item label="Length">{plural(booking.quantity, 'night', 'nights')}</Item>
            {selection?.roomTypeName && (
              <Item label="Room">
                {selection.roomTypeName}
                {selection.rooms ? ` × ${selection.rooms}` : ''}
              </Item>
            )}
            {guests !== null && <Item label="Guests">{guests}</Item>}
          </>
        ) : kind === 'CLEANING' ? (
          <>
            <Item label={booking.quantity === 1 ? 'Date' : 'First day'}>
              {formatDay(booking.startDate)}
            </Item>
            {booking.quantity > 1 && (
              <Item label="Last day">{formatDay(addDays(booking.endDate, -1))}</Item>
            )}
            <Item label="Visits">{plural(booking.quantity, 'day', 'days')}</Item>
            {selection?.serviceArea && <Item label="Area">{selection.serviceArea}</Item>}
            {selection?.address && (
              <div className="col-span-2">
                <dt className="text-text-muted">Address</dt>
                <dd className="mt-0.5 text-text">{selection.address}</dd>
              </div>
            )}
          </>
        ) : (
          <>
            <Item label="First day">{formatDay(booking.startDate)}</Item>
            <Item label="Last day">{formatDay(addDays(booking.endDate, -1))}</Item>
            <Item label="Length">{plural(booking.quantity, 'day', 'days')}</Item>
            {guests !== null && <Item label="People">{guests}</Item>}
            {selection?.ticketName && <Item label="Ticket">{selection.ticketName}</Item>}
          </>
        )}
        {selection && (selection.items.length > 0 || selection.fullPackage) && (
          <div className="col-span-2">
            <dt className="text-text-muted">
              {kind === 'HOTEL' || kind === 'CLEANING'
                ? 'Extras'
                : selection.fullPackage
                  ? 'Full package'
                  : 'Included'}
            </dt>
            <dd className="mt-0.5 text-text">
              {selection.items.map((i) => i.name).join(' · ') || '—'}
            </dd>
          </div>
        )}
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
