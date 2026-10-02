'use client';

import {
  formatKobo,
  nairaToKobo,
  type AgentExperienceView,
  type ApiResponse,
  type RoomAvailabilityView,
  type RoomTypeView,
} from '@havenhub/shared';
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from '@havenhub/ui';
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { api } from '@/lib/api/client';
import { fieldErrors as toFieldErrors } from '@/lib/api/errors';
import { formText } from '@/lib/form';

import { Section } from './experience-form';

type Hotel = NonNullable<AgentExperienceView['hotel']>;
const money = (value: string) => {
  const clean = value.replace(/,/g, '').trim();
  return clean === '' ? null : nairaToKobo(Number(clean));
};
const naira = (kobo: number | null | undefined) =>
  kobo === null || kobo === undefined ? '' : String(kobo / 100);

/**
 * Room types (public content: changes send a live hotel back to review),
 * individual rooms and their per-date availability (operations: no review).
 * Everything here is catalogue information; nothing is reserved or sold.
 */
export function HotelRoomsManager({
  experience,
  locked,
}: {
  experience: AgentExperienceView;
  locked: boolean;
}) {
  const hotel = experience.hotel!;
  const base = `/agents/me/experiences/${experience.id}`;
  return (
    <>
      <RoomTypes
        hotel={hotel}
        base={base}
        locked={locked}
        published={experience.status === 'PUBLISHED'}
      />
      <Rooms hotel={hotel} base={base} locked={locked} />
      {hotel.rooms.length > 0 && <Availability hotel={hotel} base={base} locked={locked} />}
    </>
  );
}

function useCall() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; fields: Record<string, string> } | null>(
    null,
  );
  const call = useCallback(
    async (key: string, request: () => Promise<ApiResponse<unknown>>) => {
      setBusy(key);
      setError(null);
      const res = await request();
      setBusy(null);
      if (!res.success) {
        setError({ message: res.message, fields: toFieldErrors(res) });
        return false;
      }
      router.refresh();
      return true;
    },
    [router],
  );
  return { busy, error, setError, call };
}

function RoomTypes({
  hotel,
  base,
  locked,
  published,
}: {
  hotel: Hotel;
  base: string;
  locked: boolean;
  published: boolean;
}) {
  const { busy, error, call } = useCall();
  const [editing, setEditing] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>, type?: RoomTypeView) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const maxGuests = formText(data, 'maxGuests');
    const body = {
      name: formText(data, 'name'),
      description: formText(data, 'description') || null,
      maxGuests: maxGuests ? Number(maxGuests) : null,
      priceKobo: money(formText(data, 'price')) ?? Number.NaN,
    };
    const ok = await call(type ? `save-${type.id}` : 'add', () =>
      type
        ? api('PATCH', `${base}/room-types/${type.id}`, body)
        : api('POST', `${base}/room-types`, body),
    );
    if (ok) {
      if (type) setEditing(null);
      else form.reset();
    }
  }

  const form = (type?: RoomTypeView) => (
    <form
      method="post"
      onSubmit={(e) => void submit(e, type)}
      noValidate
      className="flex flex-col gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" error={error?.fields.name}>
          {(a) => (
            <Input
              {...a}
              name="name"
              maxLength={80}
              defaultValue={type?.name}
              placeholder="e.g. Deluxe double"
            />
          )}
        </Field>
        <Field label="Price per night (₦)" error={error?.fields.priceKobo && 'Enter a price'}>
          {(a) => (
            <Input {...a} name="price" inputMode="decimal" defaultValue={naira(type?.priceKobo)} />
          )}
        </Field>
        <Field label="Sleeps" optional error={error?.fields.maxGuests}>
          {(a) => (
            <Input
              {...a}
              name="maxGuests"
              type="number"
              min={1}
              max={50}
              defaultValue={type?.maxGuests ?? ''}
            />
          )}
        </Field>
      </div>
      <Field label="Description" optional>
        {(a) => (
          <Textarea
            {...a}
            name="description"
            rows={2}
            maxLength={1000}
            defaultValue={type?.description ?? ''}
          />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        {type && (
          <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          variant={type ? 'primary' : 'secondary'}
          loading={busy === (type ? `save-${type.id}` : 'add')}
        >
          {type ? 'Save room type' : 'Add room type'}
        </Button>
      </div>
    </form>
  );

  return (
    <Section
      id="room-types"
      title="Room types"
      description={`Names and nightly prices shown to visitors.${published ? ' Changing them sends the hotel back for review.' : ''}`}
    >
      {error && !Object.keys(error.fields).length && <Alert tone="error">{error.message}</Alert>}
      {hotel.roomTypes.length === 0 && (
        <p className="text-sm text-text-secondary">
          Add at least one room type before submitting for review.
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {hotel.roomTypes.map((type) => (
          <li key={type.id} className="rounded-control border border-border p-4">
            {editing === type.id ? (
              form(type)
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold break-words text-text">{type.name}</p>
                  <p className="text-sm text-text-secondary">
                    {formatKobo(type.priceKobo)} per night
                    {type.maxGuests ? ` · sleeps ${type.maxGuests}` : ''} · {type.roomCount}{' '}
                    {type.roomCount === 1 ? 'room' : 'rooms'}
                  </p>
                </div>
                {!locked && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit ${type.name}`}
                      onClick={() => setEditing(type.id)}
                    >
                      <Pencil aria-hidden className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${type.name}`}
                      loading={busy === `delete-${type.id}`}
                      onClick={() => {
                        if (window.confirm(`Delete the room type “${type.name}”?`))
                          void call(`delete-${type.id}`, () =>
                            api('DELETE', `${base}/room-types/${type.id}`),
                          );
                      }}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {!locked && editing === null && <div className="border-t border-border pt-5">{form()}</div>}
    </Section>
  );
}

function Rooms({ hotel, base, locked }: { hotel: Hotel; base: string; locked: boolean }) {
  const { busy, error, call } = useCall();
  const typeName = new Map(hotel.roomTypes.map((t) => [t.id, t.name]));

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await call('add-room', () =>
      api('POST', `${base}/rooms`, {
        roomTypeId: formText(data, 'roomTypeId'),
        label: formText(data, 'label'),
        priceKobo: money(formText(data, 'price')),
      }),
    );
    if (ok) form.reset();
  }

  return (
    <Section
      id="rooms"
      title="Rooms"
      description="Each room has its own number or name and, optionally, its own nightly price. Changes here keep a live hotel live."
    >
      {error && !Object.keys(error.fields).length && <Alert tone="error">{error.message}</Alert>}
      {hotel.rooms.length === 0 ? (
        <p className="text-sm text-text-secondary">No rooms yet.</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <caption className="sr-only">Rooms</caption>
            <thead>
              <tr className="border-b border-border text-left text-text-muted">
                <th scope="col" className="py-2 font-medium">
                  Room
                </th>
                <th scope="col" className="py-2 font-medium">
                  Type
                </th>
                <th scope="col" className="py-2 font-medium">
                  Nightly price
                </th>
                <th scope="col" className="py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {hotel.rooms.map((room) => {
                const typePrice = hotel.roomTypes.find((t) => t.id === room.roomTypeId)?.priceKobo;
                return (
                  <tr key={room.id} className="border-b border-border last:border-0">
                    <td className="py-2.5 font-medium text-text">{room.label}</td>
                    <td className="py-2.5 text-text-secondary">{typeName.get(room.roomTypeId)}</td>
                    <td className="py-2.5 text-text-secondary">
                      {room.priceKobo !== null
                        ? formatKobo(room.priceKobo)
                        : typePrice !== undefined
                          ? `${formatKobo(typePrice)} (type)`
                          : '—'}
                    </td>
                    <td className="py-2.5">
                      {room.active ? 'Active' : <span className="text-text-muted">Inactive</span>}
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      {!locked && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={busy === `toggle-${room.id}`}
                            onClick={() =>
                              void call(`toggle-${room.id}`, () =>
                                api('PATCH', `${base}/rooms/${room.id}`, { active: !room.active }),
                              )
                            }
                          >
                            {room.active ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Delete room ${room.label}`}
                            loading={busy === `delete-${room.id}`}
                            onClick={() => {
                              if (window.confirm(`Delete room ${room.label}?`))
                                void call(`delete-${room.id}`, () =>
                                  api('DELETE', `${base}/rooms/${room.id}`),
                                );
                            }}
                          >
                            <Trash2 aria-hidden className="size-4" />
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!locked && hotel.roomTypes.length > 0 && (
        <form
          method="post"
          onSubmit={(e) => void add(e)}
          noValidate
          className="grid gap-4 border-t border-border pt-5 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-start"
        >
          <Field label="Room number or name" error={error?.fields.label}>
            {(a) => <Input {...a} name="label" maxLength={40} placeholder="e.g. 101" />}
          </Field>
          <Field label="Room type" error={error?.fields.roomTypeId}>
            {(a) => (
              <Select {...a} name="roomTypeId" defaultValue={hotel.roomTypes[0]?.id}>
                {hotel.roomTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Own price (₦)" optional error={error?.fields.priceKobo}>
            {(a) => <Input {...a} name="price" inputMode="decimal" placeholder="Type’s price" />}
          </Field>
          <Button
            type="submit"
            variant="secondary"
            loading={busy === 'add-room'}
            className="sm:mt-7"
          >
            Add room
          </Button>
        </form>
      )}
      {!locked && hotel.roomTypes.length === 0 && (
        <p className="text-sm text-text-secondary">Add a room type first.</p>
      )}
    </Section>
  );
}

const WINDOW = 14;
const todayInLagos = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const DAY = new Intl.DateTimeFormat('en-NG', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

function Availability({ hotel, base, locked }: { hotel: Hotel; base: string; locked: boolean }) {
  const { busy, error, setError, call } = useCall();
  const [from, setFrom] = useState(todayInLagos);
  const [data, setData] = useState<RoomAvailabilityView | null>(null);
  const [version, setVersion] = useState(0);
  const to = addDays(from, WINDOW - 1);

  useEffect(() => {
    let cancelled = false;
    void api<RoomAvailabilityView>('GET', `${base}/availability?from=${from}&to=${to}`).then(
      (res) => {
        if (!cancelled && res.success) setData(res.data);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [base, from, to, version, hotel.rooms.length]);

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const roomId = formText(form, 'roomId');
    const start = formText(form, 'start');
    const end = formText(form, 'end') || start;
    const action = formText(form, 'action');
    if (!start || end < start) {
      setError({ message: 'Choose a start date, and an end date on or after it.', fields: {} });
      return;
    }
    const days: string[] = [];
    for (let d = start; d <= end && days.length <= 366; d = addDays(d, 1)) days.push(d);
    if (days.length > 366) {
      setError({ message: 'Choose at most a year at a time.', fields: {} });
      return;
    }
    const price = money(formText(form, 'price'));
    const body =
      action === 'clear'
        ? { clear: days }
        : {
            set: days.map((date) => ({
              date,
              available: action !== 'close',
              priceKobo: action === 'price' ? price : null,
            })),
          };
    if (action === 'price' && price === null) {
      setError({ message: 'Enter the nightly price for these dates.', fields: {} });
      return;
    }
    if (await call('apply', () => api('PUT', `${base}/rooms/${roomId}/availability`, body))) {
      setVersion((v) => v + 1);
    }
  }

  const dates = Array.from({ length: WINDOW }, (_, i) => addDays(from, i));
  const [action, setAction] = useState('close');

  return (
    <Section
      id="availability"
      title="Availability"
      description="Rooms are open at their nightly price unless you close a date or set a different price. Visitors see how many rooms of each type are open."
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">
          {DAY.format(new Date(`${from}T00:00:00Z`))} – {DAY.format(new Date(`${to}T00:00:00Z`))}
        </p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Previous two weeks"
            disabled={from <= todayInLagos()}
            onClick={() => setFrom(addDays(from, -WINDOW))}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Next two weeks"
            onClick={() => setFrom(addDays(from, WINDOW))}
          >
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </div>
      </div>
      {!data ? (
        <p className="flex items-center gap-2 text-sm text-text-secondary">
          <Spinner /> Loading…
        </p>
      ) : (
        <div className="relative overflow-x-auto rounded-control border border-border">
          <table className="w-full min-w-[720px] text-xs">
            <caption className="sr-only">Availability per room and night</caption>
            <thead>
              <tr className="border-b border-border bg-surface-secondary">
                <th
                  scope="col"
                  className="sticky left-0 bg-surface-secondary px-3 py-2 text-left font-semibold"
                >
                  Room
                </th>
                {dates.map((d) => (
                  <th key={d} scope="col" className="px-1.5 py-2 text-center font-medium">
                    {DAY.format(new Date(`${d}T00:00:00Z`))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rooms.map((room) => (
                <tr key={room.roomId} className="border-b border-border last:border-0">
                  <th
                    scope="row"
                    className="sticky left-0 bg-surface px-3 py-2 text-left font-medium"
                  >
                    {room.label}
                    {!room.active && (
                      <span className="block font-normal text-text-muted">Inactive</span>
                    )}
                  </th>
                  {dates.map((d) => {
                    const o = room.overrides.find((x) => x.date === d);
                    const open = room.active && (o ? o.available : true);
                    return (
                      <td key={d} className="px-1.5 py-2 text-center">
                        {open ? (
                          <span
                            className={
                              o?.priceKobo != null
                                ? 'font-semibold text-primary-text'
                                : 'text-success'
                            }
                          >
                            {formatKobo(o?.priceKobo ?? room.defaultPriceKobo).replace('.00', '')}
                          </span>
                        ) : (
                          <span className="text-text-muted">Closed</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!locked && (
        <form
          method="post"
          onSubmit={(e) => void apply(e)}
          noValidate
          className="flex flex-col gap-4 border-t border-border pt-5"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Room">
              {(a) => (
                <Select {...a} name="roomId">
                  {hotel.rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="From">
              {(a) => <Input {...a} name="start" type="date" min={todayInLagos()} />}
            </Field>
            <Field label="To" optional>
              {(a) => <Input {...a} name="end" type="date" min={todayInLagos()} />}
            </Field>
            <Field label="Change">
              {(a) => (
                <Select
                  {...a}
                  name="action"
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                >
                  <option value="close">Close these nights</option>
                  <option value="open">Open at the usual price</option>
                  <option value="price">Open at a different price</option>
                  <option value="clear">Reset to usual</option>
                </Select>
              )}
            </Field>
          </div>
          {action === 'price' && (
            <Field label="Nightly price for these dates (₦)" className="sm:max-w-xs">
              {(a) => <Input {...a} name="price" inputMode="decimal" />}
            </Field>
          )}
          {error && <Alert tone="error">{error.message}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" loading={busy === 'apply'}>
              Apply
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}
