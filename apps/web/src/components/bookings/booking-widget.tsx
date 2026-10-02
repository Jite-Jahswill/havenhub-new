'use client';

import {
  ErrorCode,
  formatKobo,
  type ApiError,
  type BookingQuote,
  type CustomerBookingDetail,
  type PropertyAvailability,
  type PropertyDetail,
} from '@havenhub/shared';
import { Alert, Button, Field, Input, Select, buttonClasses } from '@havenhub/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api } from '@/lib/api/client';
import { fieldErrors } from '@/lib/api/errors';
import { formatDay, formatStay } from '@/lib/format';
import { useApiAction } from '@/lib/use-api-action';

import { PriceBreakdown } from './price-breakdown';

type Viewer = 'guest' | 'customer' | 'other';

const START_LABEL = { DAILY: 'Check-in', MONTHLY: 'Move-in date', YEARLY: 'Move-in date' } as const;
const QUANTITY_LABEL = { DAILY: 'Nights', MONTHLY: 'Months', YEARLY: 'Years' } as const;

/**
 * Date/period selection, live server quote and "Reserve". The browser never
 * calculates money: every figure shown comes from the API's quote, and the
 * API re-prices (and re-checks availability) when the booking is created.
 */
export function BookingWidget({ property, viewer }: { property: PropertyDetail; viewer: Viewer }) {
  const router = useRouter();
  const [availability, setAvailability] = useState<PropertyAvailability | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [startDate, setStartDate] = useState('');
  const [quantity, setQuantity] = useState(property.pricingPeriod === 'DAILY' ? 2 : 1);
  const [guests, setGuests] = useState(1);
  const [addCleaning, setAddCleaning] = useState(false);
  const [quote, setQuote] = useState<BookingQuote | null>(null);
  const [quoteError, setQuoteError] = useState<ApiError | null>(null);
  const [refresh, setRefresh] = useState(0);
  const reserve = useApiAction();

  const daily = property.pricingPeriod === 'DAILY';
  const period = property.pricingPeriod as keyof typeof START_LABEL;

  useEffect(() => {
    let active = true;
    void api<PropertyAvailability>('GET', `/properties/${property.id}/availability`).then((res) => {
      if (!active) return;
      if (res.success) setAvailability(res.data);
      else setLoadError(res);
    });
    return () => {
      active = false;
    };
  }, [property.id, refresh]);

  useEffect(() => {
    if (!startDate || !quantity) return;
    let active = true;
    const timer = setTimeout(() => {
      void api<BookingQuote>('POST', '/bookings/quote', {
        propertyId: property.id,
        startDate,
        quantity,
        guests: daily ? guests : undefined,
        addCleaning,
      }).then((res) => {
        if (!active) return;
        setQuote(res.success ? res.data : null);
        setQuoteError(res.success ? null : res);
      });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [property.id, startDate, quantity, guests, addCleaning, daily, refresh]);

  if (loadError) {
    return <Alert>{loadError.message}</Alert>;
  }
  if (!availability) {
    return <p className="text-sm text-text-secondary">Checking availability…</p>;
  }

  async function onReserve() {
    if (!quote) return;
    const booking = await reserve.run(() =>
      api<CustomerBookingDetail>('POST', '/bookings', {
        propertyId: property.id,
        startDate,
        quantity,
        guests: daily ? guests : undefined,
        addCleaning,
        expectedTotalKobo: quote.totalKobo,
      }),
    );
    if (booking) router.push(`/account/bookings/${booking.id}`);
    else setRefresh((n) => n + 1);
  }

  const { limits } = availability;
  const errors = fieldErrors(quoteError);
  const bookingsClosed = quoteError?.code === ErrorCode.BOOKINGS_NOT_OPEN;
  const upcoming = availability.unavailable.slice(0, 4);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={START_LABEL[period]}
          error={errors.startDate}
          className="col-span-2 sm:col-span-1"
        >
          {(a) => (
            <Input
              {...a}
              type="date"
              min={availability.earliestStartDate}
              max={availability.latestStartDate}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          )}
        </Field>
        <Field
          label={QUANTITY_LABEL[period]}
          error={errors.quantity}
          className="col-span-2 sm:col-span-1"
        >
          {(a) => (
            <Select {...a} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}>
              {Array.from({ length: limits.max - limits.min + 1 }, (_, i) => limits.min + i).map(
                (n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? limits.unit : `${limits.unit}s`}
                  </option>
                ),
              )}
            </Select>
          )}
        </Field>
        {daily && property.maxGuests !== null && (
          <Field label="Guests" error={errors.guests} className="col-span-2 sm:col-span-1">
            {(a) => (
              <Select {...a} value={guests} onChange={(e) => setGuests(Number(e.target.value))}>
                {Array.from({ length: property.maxGuests! }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? 'guest' : 'guests'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>

      {property.cleaningOption === 'AVAILABLE_FOR_FEE' && property.cleaningFeeKobo && (
        <label className="flex items-start gap-3 text-sm text-text">
          <input
            type="checkbox"
            checked={addCleaning}
            onChange={(e) => setAddCleaning(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            Add cleaning ({formatKobo(property.cleaningFeeKobo)})
            <span className="block text-xs text-text-muted">One-off fee for the stay.</span>
          </span>
        </label>
      )}

      {upcoming.length > 0 && (
        <div className="text-xs text-text-secondary">
          <p className="font-medium text-text">Already booked</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {upcoming.map((r) => (
              <li key={r.startDate}>{formatStay(r.startDate, r.endDate)}</li>
            ))}
          </ul>
        </div>
      )}

      {bookingsClosed ? (
        <Alert>{quoteError.message}</Alert>
      ) : (
        quoteError &&
        quoteError.code !== ErrorCode.VALIDATION_ERROR && (
          <Alert tone="error">{quoteError.message}</Alert>
        )
      )}

      {quote && (
        <div className="flex flex-col gap-3 rounded-control border border-border p-4">
          <p className="text-sm text-text">
            {formatDay(quote.startDate)} → {formatDay(quote.endDate)}
          </p>
          {quote.available ? (
            <PriceBreakdown
              lines={quote.lines}
              totalKobo={quote.totalKobo}
              depositKobo={quote.refundableDepositKobo}
            />
          ) : (
            <Alert tone="warning">{quote.unavailableReason}</Alert>
          )}
        </div>
      )}

      {reserve.error && <Alert tone="error">{reserve.error.message}</Alert>}

      {viewer === 'guest' ? (
        <Link
          href={`/login?next=${encodeURIComponent(`/properties/${property.slug}`)}`}
          className={buttonClasses({ className: 'w-full' })}
        >
          Sign in to book
        </Link>
      ) : viewer === 'other' ? (
        <Alert>Bookings are made from a customer account.</Alert>
      ) : (
        <Button
          className="w-full"
          disabled={!quote?.available || reserve.pending}
          loading={reserve.pending}
          onClick={onReserve}
        >
          {quote?.available ? `Reserve · ${formatKobo(quote.totalKobo)}` : 'Reserve'}
        </Button>
      )}
      <p className="text-center text-xs text-text-muted">
        You won’t be charged yet. Dates are held while you pay.
      </p>
    </div>
  );
}
