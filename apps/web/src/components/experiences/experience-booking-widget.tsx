'use client';

import {
  EXPERIENCE_LIMITS,
  ErrorCode,
  WEEKDAY_LABELS,
  addDays,
  daysBetween,
  formatKobo,
  todayInNigeria,
  type ApiError,
  type CustomerBookingDetail,
  type ExperienceBookingQuote,
  type ExperienceDetail,
} from '@havenhub/shared';
import { Alert, Button, Field, Input, Select, buttonClasses, cn } from '@havenhub/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { PriceBreakdown } from '@/components/bookings/price-breakdown';
import { api } from '@/lib/api/client';
import { fieldErrors } from '@/lib/api/errors';
import { formatDay } from '@/lib/format';
import { useApiAction } from '@/lib/use-api-action';

type Viewer = 'guest' | 'customer' | 'other';

const WEEKDAY_ORDER = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

const range = (from: number, to: number) =>
  Array.from({ length: Math.max(to - from + 1, 0) }, (_, i) => from + i);

/**
 * Booking a tour, event, hotel or cleaning: everything is per day (per
 * night for hotels). The customer takes the full package or picks items; every figure
 * shown comes from the server's quote, which the API re-checks on booking.
 */
export function ExperienceBookingWidget({
  item,
  viewer,
  path,
}: {
  item: ExperienceDetail;
  viewer: Viewer;
  path: string;
}) {
  const router = useRouter();
  const today = todayInNigeria();
  const hotel = item.kind === 'HOTEL';
  const cleaning = item.kind === 'CLEANING';
  const areas = item.cleaning?.serviceAreas ?? [];
  const workDays = useMemo(() => item.cleaning?.availableDays ?? [], [item.cleaning]);
  // Cleaning: the first day from today that the cleaner works.
  const firstWorkDay = useMemo(() => {
    if (!cleaning || workDays.length === 0) return today;
    for (let d = today, i = 0; i < 14; d = addDays(d, 1), i++) {
      if (workDays.includes(WEEKDAY_ORDER[new Date(`${d}T12:00:00Z`).getUTCDay()]!)) return d;
    }
    return today;
  }, [cleaning, workDays, today]);

  // Which start dates are allowed, and how long a booking may be.
  const eventDays = useMemo(() => {
    if (item.kind !== 'EVENT' || !item.event?.startsAt) return null;
    const first = todayInNigeria(new Date(item.event.startsAt));
    const last = todayInNigeria(new Date(item.event.endsAt ?? item.event.startsAt));
    const days: string[] = [];
    for (let d = first > today ? first : today; d <= last; d = addDays(d, 1)) days.push(d);
    return days;
  }, [item.kind, item.event, today]);
  const tourDates = useMemo(
    () =>
      item.kind === 'TOUR'
        ? [...new Set((item.tour?.dates ?? []).map((d) => todayInNigeria(new Date(d))))].filter(
            (d) => d >= today,
          )
        : [],
    [item.kind, item.tour, today],
  );
  const roomTypes = (item.hotel?.roomTypes ?? []).filter((t) => t.roomCount > 0);
  const tickets = item.event?.ticketTypes ?? [];

  const [startDate, setStartDate] = useState(eventDays?.[0] ?? tourDates[0] ?? firstWorkDay);
  const [days, setDays] = useState(1);
  const [people, setPeople] = useState(1);
  const [roomTypeId, setRoomTypeId] = useState(roomTypes[0]?.id ?? '');
  const [rooms, setRooms] = useState(1);
  const [ticketTypeId, setTicketTypeId] = useState(tickets[0]?.id ?? '');
  // Tours and events: the package is the product. Hotels and cleaning: items are extras.
  const [fullPackage, setFullPackage] = useState(
    item.packageItems.length > 0 && !hotel && !cleaning,
  );
  const [serviceArea, setServiceArea] = useState(areas[0] ?? '');
  const [address, setAddress] = useState('');
  // The agent's promo code: typed in `codeInput`, applied as `code` (the server validates it).
  const [codeInput, setCodeInput] = useState('');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [quote, setQuote] = useState<ExperienceBookingQuote | null>(null);
  const [quoteError, setQuoteError] = useState<ApiError | null>(null);
  const reserve = useApiAction();

  const maxDays = eventDays
    ? Math.max(eventDays.length - Math.max(eventDays.indexOf(startDate), 0), 1)
    : EXPERIENCE_LIMITS.bookingDays;
  const roomType = roomTypes.find((t) => t.id === roomTypeId);
  const maxRooms = Math.min(roomType?.roomCount ?? 1, EXPERIENCE_LIMITS.bookingRooms);
  const capacity = item.event?.capacity ?? item.tour?.capacity ?? null;
  const maxPeople = hotel
    ? Math.min((roomType?.maxGuests ?? 4) * rooms, EXPERIENCE_LIMITS.bookingPeople)
    : Math.min(capacity ?? EXPERIENCE_LIMITS.bookingPeople, EXPERIENCE_LIMITS.bookingPeople);
  const effectiveDays = Math.min(days, maxDays);
  const effectivePeople = Math.min(people, maxPeople);

  const request = useMemo(
    () => ({
      experienceId: item.id,
      startDate,
      days: effectiveDays,
      people: effectivePeople,
      ...(hotel ? { roomTypeId, rooms: Math.min(rooms, maxRooms) } : {}),
      ...(item.kind === 'EVENT' && ticketTypeId ? { ticketTypeId } : {}),
      fullPackage,
      itemIds: fullPackage ? [] : itemIds,
      ...(cleaning && serviceArea ? { serviceArea } : {}),
      ...(cleaning && address.trim().length >= 5 ? { address: address.trim() } : {}),
      ...(code ? { code } : {}),
    }),
    [
      item.id,
      item.kind,
      startDate,
      effectiveDays,
      effectivePeople,
      hotel,
      roomTypeId,
      rooms,
      maxRooms,
      ticketTypeId,
      fullPackage,
      itemIds,
      cleaning,
      serviceArea,
      address,
      code,
    ],
  );

  useEffect(() => {
    if (!startDate) return;
    let active = true;
    const timer = setTimeout(() => {
      void api<ExperienceBookingQuote>('POST', '/bookings/experience/quote', request).then(
        (res) => {
          if (!active) return;
          if (!res.success && res.code === ErrorCode.DISCOUNT_CODE_INVALID) {
            // Show why, then quote again without the code.
            setCodeError(res.message);
            setCode('');
            return;
          }
          setQuote(res.success ? res.data : null);
          setQuoteError(res.success ? null : res);
        },
      );
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [request, startDate]);

  async function onReserve() {
    if (!quote) return;
    const booking = await reserve.run(() =>
      api<CustomerBookingDetail>('POST', '/bookings/experience', {
        ...request,
        expectedTotalKobo: quote.totalKobo,
      }),
    );
    if (booking) router.push(`/account/bookings/${booking.id}`);
  }

  const errors = fieldErrors(quoteError);
  const needsAddress = cleaning && address.trim().length < 5;
  const applyCode = () => {
    setCodeError(null);
    setCode(codeInput.trim().toUpperCase());
  };
  const unit = hotel ? 'night' : 'day';
  const toggleItem = (id: string) =>
    setItemIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={hotel ? 'Check-in' : 'Start date'}
          error={errors.startDate}
          className="col-span-2 sm:col-span-1"
        >
          {(a) =>
            eventDays || tourDates.length ? (
              <Select {...a} value={startDate} onChange={(e) => setStartDate(e.target.value)}>
                {(eventDays ?? tourDates).map((d) => (
                  <option key={d} value={d}>
                    {formatDay(d)}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                {...a}
                type="date"
                min={today}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            )
          }
        </Field>
        <Field
          label={hotel ? 'Nights' : 'Days'}
          error={errors.days}
          className="col-span-2 sm:col-span-1"
        >
          {(a) => (
            <Select {...a} value={effectiveDays} onChange={(e) => setDays(Number(e.target.value))}>
              {range(1, maxDays).map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? unit : `${unit}s`}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {hotel && (
          <>
            <Field label="Room type" error={errors.roomTypeId} className="col-span-2">
              {(a) => (
                <Select {...a} value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)}>
                  {roomTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {formatKobo(t.priceKobo)} a night
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Rooms" error={errors.rooms} className="col-span-2 sm:col-span-1">
              {(a) => (
                <Select
                  {...a}
                  value={Math.min(rooms, maxRooms)}
                  onChange={(e) => setRooms(Number(e.target.value))}
                >
                  {range(1, maxRooms).map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? 'room' : 'rooms'}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        )}

        {item.kind === 'EVENT' && tickets.length > 0 && (
          <Field label="Ticket" error={errors.ticketTypeId} className="col-span-2">
            {(a) => (
              <Select {...a} value={ticketTypeId} onChange={(e) => setTicketTypeId(e.target.value)}>
                {tickets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {formatKobo(t.priceKobo)} per person a day
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {!cleaning && (
          <Field
            label={hotel ? 'Guests' : 'People'}
            error={errors.people}
            className="col-span-2 sm:col-span-1"
          >
            {(a) => (
              <Select
                {...a}
                value={effectivePeople}
                onChange={(e) => setPeople(Number(e.target.value))}
              >
                {range(1, maxPeople).map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? 'person' : 'people'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {cleaning && (
          <>
            {workDays.length > 0 && (
              <p className="col-span-2 text-xs text-text-muted">
                Works on {workDays.map((d) => WEEKDAY_LABELS[d]).join(', ')}.
              </p>
            )}
            {areas.length > 0 && (
              <Field label="Area" error={errors.serviceArea} className="col-span-2">
                {(a) => (
                  <Select
                    {...a}
                    value={serviceArea}
                    onChange={(e) => setServiceArea(e.target.value)}
                  >
                    {areas.map((area) => (
                      <option key={area} value={area}>
                        {area}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field
              label="Address to clean"
              hint="Shared with the cleaner once you book."
              error={errors.address}
              className="col-span-2"
            >
              {(a) => (
                <Input
                  {...a}
                  value={address}
                  maxLength={240}
                  autoComplete="street-address"
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. 12 Market Road, Ughelli"
                />
              )}
            </Field>
          </>
        )}
      </div>

      {item.packageItems.length > 0 && (
        <fieldset className="flex flex-col gap-3 rounded-control border border-border p-4">
          <legend className="px-1 text-sm font-semibold text-text">
            {hotel || cleaning ? 'Extras' : 'What to pay for'}
          </legend>
          <div role="radiogroup" className="grid grid-cols-2 gap-2 text-sm">
            {[
              [true, hotel || cleaning ? 'All extras' : 'Full package'],
              [false, hotel || cleaning ? 'Choose extras' : 'Choose items'],
            ].map(([value, label]) => (
              <button
                key={String(value)}
                type="button"
                role="radio"
                aria-checked={fullPackage === value}
                onClick={() => setFullPackage(value as boolean)}
                className={cn(
                  'rounded-control border px-3 py-2 font-medium',
                  fullPackage === value
                    ? 'border-primary bg-primary-subtle text-primary-text'
                    : 'border-border text-text-secondary hover:text-text',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <ul className="flex flex-col gap-2">
            {item.packageItems.map((p) => (
              <li key={p.id}>
                <label className="flex items-start gap-3 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={fullPackage || itemIds.includes(p.id)}
                    disabled={fullPackage}
                    onChange={() => toggleItem(p.id)}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span className="flex-1">
                    {p.name}
                    {p.description && (
                      <span className="block text-xs text-text-muted">{p.description}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-right text-text-secondary">
                    {formatKobo(p.priceKobo)}
                    <span className="block text-xs text-text-muted">
                      {p.perPerson ? `per person a ${unit}` : `per ${unit}`}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="experience-promo-code" className="text-sm font-medium text-text">
          Promo code
        </label>
        <div className="flex gap-2">
          <Input
            id="experience-promo-code"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyCode();
              }
            }}
            maxLength={32}
            autoComplete="off"
            className="uppercase"
            aria-invalid={codeError ? true : undefined}
            aria-describedby={codeError ? 'experience-promo-error' : undefined}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={applyCode}
            disabled={!codeInput.trim()}
          >
            Apply
          </Button>
        </div>
        {codeError && (
          <p id="experience-promo-error" className="text-xs text-error">
            {codeError}
          </p>
        )}
        {quote?.promo && (
          <p className="text-xs text-success">
            {quote.promo.code} applied: {quote.promo.label}.{' '}
            <button
              type="button"
              className="underline"
              onClick={() => {
                setCode('');
                setCodeInput('');
              }}
            >
              Remove
            </button>
          </p>
        )}
      </div>

      {quoteError && quoteError.code !== 'VALIDATION_ERROR' && (
        <Alert tone="error">{quoteError.message}</Alert>
      )}
      {quoteError?.code === 'VALIDATION_ERROR' &&
        !Object.keys(errors).some((k) => k !== 'itemIds') && (
          <Alert tone="warning">{errors.itemIds ?? quoteError.message}</Alert>
        )}

      {quote && (
        <div className="flex flex-col gap-3 rounded-control border border-border p-4">
          <p className="text-sm text-text">
            {formatDay(quote.startDate)} →{' '}
            {formatDay(hotel ? quote.endDate : addDays(quote.endDate, -1))}
            <span className="text-text-muted">
              {' '}
              · {daysBetween(quote.startDate, quote.endDate)}{' '}
              {daysBetween(quote.startDate, quote.endDate) === 1 ? unit : `${unit}s`}
            </span>
          </p>
          {quote.available ? (
            <PriceBreakdown lines={quote.lines} totalKobo={quote.totalKobo} depositKobo={0} />
          ) : (
            <Alert tone="warning">{quote.unavailableReason}</Alert>
          )}
        </div>
      )}

      {reserve.error && <Alert tone="error">{reserve.error.message}</Alert>}

      {viewer === 'guest' ? (
        <Link
          href={`/login?next=${encodeURIComponent(path)}`}
          className={buttonClasses({ className: 'w-full' })}
        >
          Sign in to book
        </Link>
      ) : viewer === 'other' ? (
        <Alert>Bookings are made from a customer account.</Alert>
      ) : (
        <Button
          className="w-full"
          disabled={!quote?.available || needsAddress || reserve.pending}
          loading={reserve.pending}
          onClick={onReserve}
        >
          {needsAddress
            ? 'Enter the address to book'
            : quote?.available
              ? `Book · ${formatKobo(quote.totalKobo)}`
              : 'Book'}
        </Button>
      )}
      <p className="text-center text-xs text-text-muted">
        You pay securely with Paystack on the next step. Your places are held while you pay.
      </p>
    </div>
  );
}
