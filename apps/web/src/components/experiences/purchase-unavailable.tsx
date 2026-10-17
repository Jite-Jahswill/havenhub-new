import { Info } from 'lucide-react';

const WHAT = {
  EVENT: 'Ticket sales',
  TOUR: 'Tour booking',
  HOTEL: 'Room booking',
  CLEANING: 'Booking cleaners',
} as const;

/**
 * Shown instead of a booking form when a listing does not take online
 * bookings (the provider has not switched it on, or it is a cleaning
 * service) — never a fake checkout.
 */
export function PurchaseUnavailable({ kind }: { kind: keyof typeof WHAT }) {
  return (
    <div
      role="note"
      className="flex gap-3 rounded-control border border-border bg-surface-secondary px-4 py-3.5 text-sm"
    >
      <Info aria-hidden className="mt-0.5 size-4.5 shrink-0 text-text-secondary" />
      <div>
        <p className="font-semibold text-text">
          {WHAT[kind]} isn’t available online for this listing
        </p>
        <p className="mt-1 text-text-secondary">
          Prices shown are listed by the provider for information. Message them to arrange it.
        </p>
      </div>
    </div>
  );
}
