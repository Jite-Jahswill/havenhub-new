'use client';

import {
  EXPERIENCE_KIND_LABELS,
  ErrorCode,
  TOUR_CATEGORY_LABELS,
  WEEKDAYS,
  WEEKDAY_LABELS,
  createExperienceSchema,
  nairaToKobo,
  updateExperienceSchema,
  type AgentExperienceView,
  type AmenityView,
  type ExperienceKind,
} from '@havenhub/shared';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  Textarea,
} from '@havenhub/ui';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';

import { ApiErrorAlert } from '@/components/subscriptions/upgrade-prompt';
import { api } from '@/lib/api/client';
import { fromLagosInput, toLagosInput } from '@/lib/experiences';
import { formText } from '@/lib/form';
import { AMENITY_CATEGORY_LABELS, NIGERIAN_STATES } from '@/lib/labels';
import { useApiAction } from '@/lib/use-api-action';

const LocationMap = dynamic(
  () => import('@/components/map/location-map').then((m) => m.LocationMap),
  { ssr: false, loading: () => <div className="size-full animate-pulse bg-surface-secondary" /> },
);

const naira = (kobo: number | null | undefined) =>
  kobo === null || kobo === undefined ? '' : String(kobo / 100);

const ADDRESS_LABEL: Record<ExperienceKind, string> = {
  EVENT: 'Venue address',
  TOUR: 'Meeting point',
  HOTEL: 'Hotel address',
  CLEANING: 'Business address',
};

/**
 * Create/edit form for events, tours, hotels and cleaning services. Drafts
 * may be saved incomplete; the status panel lists what review still needs.
 * Prices are entered in naira and sent as integer kobo. Event times are
 * Nigerian time (WAT), whatever the browser's timezone.
 */
export function ExperienceForm({
  kind,
  experience,
  amenities,
  locked,
}: {
  kind: ExperienceKind;
  experience?: AgentExperienceView;
  amenities: AmenityView[];
  locked?: boolean;
}) {
  const router = useRouter();
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [saved, setSaved] = useState(false);
  const [point, setPoint] = useState<{ lat: number | null; lng: number | null }>({
    lat: experience?.latitude ?? null,
    lng: experience?.longitude ?? null,
  });
  const published = experience?.status === 'PUBLISHED';
  const e = experience;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const text = (name: string) => formText(form, name) || null;
    const int = (name: string) => {
      const value = formText(form, name);
      return value === '' ? null : Number(value);
    };
    const money = (name: string) => {
      const value = formText(form, name).replace(/,/g, '');
      return value === '' ? null : nairaToKobo(Number(value));
    };

    const details =
      kind === 'EVENT'
        ? {
            event: {
              startsAt: fromLagosInput(formText(form, 'startsAt')),
              endsAt: fromLagosInput(formText(form, 'endsAt')),
              capacity: int('capacity'),
              organizer: text('organizer'),
              hospitality: text('hospitality'),
              terms: text('terms'),
            },
          }
        : kind === 'TOUR'
          ? {
              tour: {
                category: (text('category') as never) ?? null,
                priceKobo: money('price'),
                priceNote: text('priceNote'),
                capacity: int('capacity'),
              },
            }
          : kind === 'HOTEL'
            ? {
                hotel: {
                  food: text('food'),
                  hospitality: text('hospitality'),
                  cleaning: text('cleaning'),
                },
              }
            : {
                cleaning: {
                  priceKobo: money('price'),
                  priceNote: text('priceNote'),
                  serviceAreas: formText(form, 'serviceAreas')
                    .split(/[,\n]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                  availableDays: form.getAll('availableDays').map(String),
                  availabilityNote: text('availabilityNote'),
                },
              };

    const values = {
      title: formText(form, 'title'),
      description: text('description'),
      discountPercent: formText(form, 'discountPercent')
        ? Number(formText(form, 'discountPercent'))
        : null,
      addressLine: text('addressLine'),
      city: text('city'),
      state: text('state'),
      latitude: point.lat,
      longitude: point.lng,
      amenityIds: form.getAll('amenityIds').map(String),
      ...details,
    };

    if (e) {
      const input = validate(updateExperienceSchema, values);
      if (!input) return;
      const result = await run(() =>
        api<AgentExperienceView>('PATCH', `/agents/me/experiences/${e.id}`, input),
      );
      if (result) {
        setSaved(true);
        router.refresh();
      }
    } else {
      const input = validate(createExperienceSchema, { kind, ...values });
      if (!input) return;
      const result = await run(() =>
        api<AgentExperienceView>('POST', '/agents/me/experiences', input),
      );
      if (result) router.push(`/agent/experiences/${result.id}?created=1`);
    }
  }

  // Detail errors arrive as e.g. "event.endsAt"; show them on the field.
  const err = (name: string) =>
    fieldErrors[name] ??
    fieldErrors[`event.${name}`] ??
    fieldErrors[`tour.${name}`] ??
    fieldErrors[`hotel.${name}`] ??
    fieldErrors[`cleaning.${name}`];
  const grouped = Object.entries(AMENITY_CATEGORY_LABELS)
    .map(([category, label]) => ({
      label,
      items: amenities.filter((a) => a.category === category),
    }))
    .filter((g) => g.items.length);
  const selected = new Set(e?.amenityIds ?? []);
  const one = EXPERIENCE_KIND_LABELS[kind].one.toLowerCase();

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <fieldset disabled={locked} className="contents">
        <Section id="basics" title="Basic information">
          <Field label="Title" error={err('title')}>
            {(a) => <Input {...a} name="title" defaultValue={e?.title} maxLength={120} required />}
          </Field>
          <Field
            label="Description"
            error={err('description')}
            hint={`What should people know about this ${one}? At least 30 characters.`}
          >
            {(a) => (
              <Textarea
                {...a}
                name="description"
                defaultValue={e?.description ?? ''}
                rows={6}
                maxLength={5000}
              />
            )}
          </Field>
          <Field
            label="Discount (%)"
            optional
            hint="Shown as “X% off” next to your price (1–90). Leave empty for no discount."
            error={err('discountPercent')}
          >
            {(a) => (
              <Input
                {...a}
                name="discountPercent"
                type="number"
                inputMode="numeric"
                min={1}
                max={90}
                step={1}
                defaultValue={e?.discountPercent ?? ''}
                className="max-w-32"
              />
            )}
          </Field>
        </Section>

        {kind === 'EVENT' && (
          <Section
            id="event"
            title="Date, time & organiser"
            description="Times are Nigerian time (WAT)."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Starts" error={err('startsAt')}>
                {(a) => (
                  <Input
                    {...a}
                    name="startsAt"
                    type="datetime-local"
                    defaultValue={toLagosInput(e?.event?.startsAt)}
                  />
                )}
              </Field>
              <Field label="Ends" error={err('endsAt')}>
                {(a) => (
                  <Input
                    {...a}
                    name="endsAt"
                    type="datetime-local"
                    defaultValue={toLagosInput(e?.event?.endsAt)}
                  />
                )}
              </Field>
              <Field label="Organiser" optional error={err('organizer')}>
                {(a) => (
                  <Input
                    {...a}
                    name="organizer"
                    maxLength={160}
                    defaultValue={e?.event?.organizer ?? ''}
                  />
                )}
              </Field>
              <Field label="Capacity" optional error={err('capacity')}>
                {(a) => (
                  <Input
                    {...a}
                    name="capacity"
                    type="number"
                    min={1}
                    defaultValue={e?.event?.capacity ?? ''}
                  />
                )}
              </Field>
            </div>
            <Field
              label="Hospitality"
              optional
              hint="Food, drinks, seating, parking…"
              error={err('hospitality')}
            >
              {(a) => (
                <Textarea
                  {...a}
                  name="hospitality"
                  rows={3}
                  maxLength={2000}
                  defaultValue={e?.event?.hospitality ?? ''}
                />
              )}
            </Field>
            <Field
              label="Terms"
              optional
              hint="Entry rules, age limits, dress code…"
              error={err('terms')}
            >
              {(a) => (
                <Textarea
                  {...a}
                  name="terms"
                  rows={4}
                  maxLength={5000}
                  defaultValue={e?.event?.terms ?? ''}
                />
              )}
            </Field>
          </Section>
        )}

        {kind === 'TOUR' && (
          <Section
            id="tour"
            title="Tour details"
            description="Enter amounts in naira. Prices are shown to visitors; nothing is charged on HavenHub yet."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Category" error={err('category')}>
                {(a) => (
                  <Select {...a} name="category" defaultValue={e?.tour?.category ?? ''}>
                    <option value="">Select</option>
                    {Object.entries(TOUR_CATEGORY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Group size" optional error={err('capacity')}>
                {(a) => (
                  <Input
                    {...a}
                    name="capacity"
                    type="number"
                    min={1}
                    defaultValue={e?.tour?.capacity ?? ''}
                  />
                )}
              </Field>
              <Field label="Price (₦)" optional error={err('priceKobo')}>
                {(a) => (
                  <Input
                    {...a}
                    name="price"
                    inputMode="decimal"
                    defaultValue={naira(e?.tour?.priceKobo)}
                  />
                )}
              </Field>
              <Field
                label="Price covers"
                optional
                hint="e.g. per person, per group"
                error={err('priceNote')}
              >
                {(a) => (
                  <Input
                    {...a}
                    name="priceNote"
                    maxLength={120}
                    defaultValue={e?.tour?.priceNote ?? ''}
                  />
                )}
              </Field>
            </div>
          </Section>
        )}

        {kind === 'HOTEL' && (
          <Section id="hotel" title="Food & services">
            <Field
              label="Food"
              optional
              hint="Restaurant, breakfast, room service…"
              error={err('food')}
            >
              {(a) => (
                <Textarea
                  {...a}
                  name="food"
                  rows={3}
                  maxLength={2000}
                  defaultValue={e?.hotel?.food ?? ''}
                />
              )}
            </Field>
            <Field
              label="Hospitality"
              optional
              hint="Front desk, airport shuttle, concierge…"
              error={err('hospitality')}
            >
              {(a) => (
                <Textarea
                  {...a}
                  name="hospitality"
                  rows={3}
                  maxLength={2000}
                  defaultValue={e?.hotel?.hospitality ?? ''}
                />
              )}
            </Field>
            <Field
              label="Cleaning"
              optional
              hint="Housekeeping schedule, laundry…"
              error={err('cleaning')}
            >
              {(a) => (
                <Textarea
                  {...a}
                  name="cleaning"
                  rows={3}
                  maxLength={2000}
                  defaultValue={e?.hotel?.cleaning ?? ''}
                />
              )}
            </Field>
          </Section>
        )}

        {kind === 'CLEANING' && (
          <Section
            id="cleaning"
            title="Service & availability"
            description="Posting a cleaning service is free. Prices are shown to customers; nothing is charged on HavenHub yet."
          >
            <Field
              label="Service areas"
              hint="Areas or cities you cover, separated by commas"
              error={err('serviceAreas')}
            >
              {(a) => (
                <Textarea
                  {...a}
                  name="serviceAreas"
                  rows={2}
                  defaultValue={e?.cleaning?.serviceAreas.join(', ') ?? ''}
                />
              )}
            </Field>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-text">Days you work</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {WEEKDAYS.map((day) => (
                  <label key={day} className="flex items-center gap-2 text-sm text-text">
                    <input
                      type="checkbox"
                      name="availableDays"
                      value={day}
                      defaultChecked={e?.cleaning?.availableDays.includes(day)}
                      className="size-4 accent-primary"
                    />
                    {WEEKDAY_LABELS[day]}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field
              label="Availability note"
              optional
              hint="e.g. 8am–6pm, weekends by arrangement"
              error={err('availabilityNote')}
            >
              {(a) => (
                <Input
                  {...a}
                  name="availabilityNote"
                  maxLength={300}
                  defaultValue={e?.cleaning?.availabilityNote ?? ''}
                />
              )}
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Price (₦)" optional error={err('priceKobo')}>
                {(a) => (
                  <Input
                    {...a}
                    name="price"
                    inputMode="decimal"
                    defaultValue={naira(e?.cleaning?.priceKobo)}
                  />
                )}
              </Field>
              <Field
                label="Price covers"
                optional
                hint="e.g. per visit, per room"
                error={err('priceNote')}
              >
                {(a) => (
                  <Input
                    {...a}
                    name="priceNote"
                    maxLength={120}
                    defaultValue={e?.cleaning?.priceNote ?? ''}
                  />
                )}
              </Field>
            </div>
          </Section>
        )}

        <Section
          id="location"
          title="Location"
          description={
            kind === 'CLEANING'
              ? 'Where your business is based.'
              : 'Click the map to place the pin (optional).'
          }
        >
          <Field
            label={ADDRESS_LABEL[kind]}
            optional={kind === 'CLEANING'}
            error={err('addressLine')}
          >
            {(a) => (
              <Input
                {...a}
                name="addressLine"
                maxLength={240}
                defaultValue={e?.addressLine ?? ''}
              />
            )}
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="City / town" error={err('city')}>
              {(a) => <Input {...a} name="city" maxLength={100} defaultValue={e?.city ?? ''} />}
            </Field>
            <Field label="State" error={err('state')}>
              {(a) => (
                <Select {...a} name="state" defaultValue={e?.state ?? ''}>
                  <option value="">Select</option>
                  {NIGERIAN_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          {kind !== 'CLEANING' && (
            <div>
              <div className="h-64 overflow-hidden rounded-control border border-border">
                <LocationMap
                  latitude={point.lat}
                  longitude={point.lng}
                  onPick={locked ? undefined : (lat, lng) => setPoint({ lat, lng })}
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-text-muted">
                <span className={err('latitude') ? 'text-error' : undefined}>
                  {err('latitude') ??
                    (point.lat !== null
                      ? `Pinned at ${point.lat.toFixed(5)}, ${point.lng!.toFixed(5)}`
                      : 'No location pinned.')}
                </span>
                {point.lat !== null && !locked && (
                  <button
                    type="button"
                    onClick={() => setPoint({ lat: null, lng: null })}
                    className="font-medium text-text-secondary underline"
                  >
                    Remove pin
                  </button>
                )}
              </div>
            </div>
          )}
        </Section>

        {grouped.length > 0 && (
          <Section id="amenities" title="Amenities" description="Optional.">
            <div className="grid gap-8 sm:grid-cols-2">
              {grouped.map((group) => (
                <fieldset key={group.label}>
                  <legend className="mb-3 text-sm font-semibold text-text">{group.label}</legend>
                  <div className="flex flex-col gap-2.5">
                    {group.items.map((amenity) => (
                      <label key={amenity.id} className="flex items-center gap-3 text-sm text-text">
                        <input
                          type="checkbox"
                          name="amenityIds"
                          value={amenity.id}
                          defaultChecked={selected.has(amenity.id)}
                          className="size-4 accent-primary"
                        />
                        {amenity.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          </Section>
        )}
      </fieldset>

      {!locked && (
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t border-border bg-background/95 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-card sm:border sm:px-6">
          {error && error.code !== ErrorCode.VALIDATION_ERROR && <ApiErrorAlert error={error} />}
          {error?.code === ErrorCode.VALIDATION_ERROR && (
            <Alert tone="error">Please fix the highlighted fields.</Alert>
          )}
          {saved && (
            <Alert tone="success">
              {published ? 'Saved. Your changes have been sent for review.' : 'Draft saved.'}
            </Alert>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-secondary">
              {published
                ? 'Saving changes to a live listing sends it back for review.'
                : 'You can save an incomplete draft and finish it later.'}
            </p>
            <Button type="submit" loading={pending}>
              {e ? 'Save changes' : 'Create draft'}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-28">
      <CardHeader title={title} description={description} />
      <CardBody className="flex flex-col gap-5">{children}</CardBody>
    </Card>
  );
}
