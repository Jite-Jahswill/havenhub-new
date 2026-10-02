import { Info } from 'lucide-react';

const WHAT = {
  EVENT: 'Ticket sales',
  TOUR: 'Tour booking',
  HOTEL: 'Room booking',
  CLEANING: 'Booking cleaners',
} as const;

/**
 * Purchasing for events, tours, hotels and cleaning is not part of this
 * release. This is shown instead of a buy/book button — never a fake checkout.
 */
export function PurchaseUnavailable({ kind }: { kind: keyof typeof WHAT }) {
  return (
    <div
      role="note"
      className="flex gap-3 rounded-control border border-border bg-surface-secondary px-4 py-3.5 text-sm"
    >
      <Info aria-hidden className="mt-0.5 size-4.5 shrink-0 text-text-secondary" />
      <div>
        <p className="font-semibold text-text">{WHAT[kind]} on HavenHub is coming later</p>
        <p className="mt-1 text-text-secondary">
          Prices shown are listed by the organiser for information. Nothing can be paid for here yet
          — message them with any questions.
        </p>
      </div>
    </div>
  );
}
