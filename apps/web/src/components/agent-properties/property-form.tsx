'use client';

import {
  CleaningOption,
  ErrorCode,
  NON_RESIDENTIAL_TYPES,
  PropertyType,
  createPropertySchema,
  nairaToKobo,
  updatePropertySchema,
  type AgentPropertyView,
  type AmenityView,
  type ListingType,
  type PricingPeriod,
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
  cn,
} from '@havenhub/ui';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';

import { ApiErrorAlert } from '@/components/subscriptions/upgrade-prompt';
import { api } from '@/lib/api/client';
import { formText } from '@/lib/form';
import {
  AMENITY_CATEGORY_LABELS,
  CLEANING_LABELS,
  NIGERIAN_STATES,
  PROPERTY_TYPE_LABELS,
} from '@/lib/labels';
import { useApiAction } from '@/lib/use-api-action';

const LocationMap = dynamic(
  () => import('@/components/map/location-map').then((m) => m.LocationMap),
  {
    ssr: false,
    loading: () => <div className="size-full animate-pulse bg-surface-secondary" />,
  },
);

const PERIODS: [PricingPeriod, string][] = [
  ['DAILY', 'Per night (short stay)'],
  ['MONTHLY', 'Per month'],
  ['YEARLY', 'Per year'],
];

const naira = (kobo: number | null | undefined) => (kobo ? String(kobo / 100) : '');

/**
 * Create/edit form. Drafts may be saved incomplete; the status panel lists
 * what is still needed before review. Amounts are entered in naira and sent
 * as integer kobo.
 */
export function PropertyForm({
  property,
  amenities,
  locked,
}: {
  property?: AgentPropertyView;
  amenities: AmenityView[];
  locked?: boolean;
}) {
  const router = useRouter();
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [saved, setSaved] = useState(false);
  const [listingType, setListingType] = useState<ListingType>(property?.listingType ?? 'RENT');
  const [propertyType, setPropertyType] = useState<PropertyType>(
    property?.propertyType ?? 'APARTMENT',
  );
  const [period, setPeriod] = useState<PricingPeriod | ''>(property?.pricingPeriod ?? '');
  const [cleaning, setCleaning] = useState<CleaningOption | ''>(property?.cleaningOption ?? '');
  const [point, setPoint] = useState<{ lat: number | null; lng: number | null }>({
    lat: property?.latitude ?? null,
    lng: property?.longitude ?? null,
  });
  const residential = !NON_RESIDENTIAL_TYPES.includes(propertyType);
  const published = property?.status === 'PUBLISHED';

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

    const values = {
      title: formText(form, 'title'),
      propertyType,
      listingType,
      description: text('description'),
      pricingPeriod: listingType === 'SALE' ? 'SALE' : period || null,
      addressLine: text('addressLine'),
      city: text('city'),
      lga: text('lga'),
      state: text('state'),
      latitude: point.lat,
      longitude: point.lng,
      sizeSqm: int('sizeSqm'),
      bedrooms: residential ? int('bedrooms') : null,
      bathrooms: residential ? int('bathrooms') : null,
      toilets: residential ? int('toilets') : null,
      maxGuests: period === 'DAILY' ? int('maxGuests') : null,
      parkingSpaces: int('parkingSpaces'),
      furnished: form.get('furnished') === 'on',
      serviced: form.get('serviced') === 'on',
      priceKobo: money('price'),
      cautionFeeKobo: listingType === 'RENT' ? money('cautionFee') : null,
      discountPercent: int('discountPercent'),
      cleaningOption: listingType === 'RENT' ? cleaning || null : null,
      cleaningFeeKobo: cleaning === 'AVAILABLE_FOR_FEE' ? money('cleaningFee') : null,
      availableFrom: text('availableFrom'),
      amenityIds: form.getAll('amenityIds').map(String),
    };

    if (property) {
      const input = validate(updatePropertySchema, values);
      if (!input) return;
      const result = await run(() =>
        api<AgentPropertyView>('PATCH', `/agents/me/properties/${property.id}`, input),
      );
      if (result) {
        setSaved(true);
        router.refresh();
      }
    } else {
      const input = validate(createPropertySchema, values);
      if (!input) return;
      const result = await run(() =>
        api<AgentPropertyView>('POST', '/agents/me/properties', input),
      );
      if (result) router.push(`/agent/properties/${result.id}?created=1`);
    }
  }

  const err = (name: string) => fieldErrors[name];
  const grouped = Object.entries(AMENITY_CATEGORY_LABELS)
    .map(([category, label]) => ({
      label,
      items: amenities.filter((a) => a.category === category),
    }))
    .filter((g) => g.items.length);
  const selected = new Set(property?.amenityIds ?? []);

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <fieldset disabled={locked} className="contents">
        <Section id="basics" title="Basic information">
          <Field
            label="Title"
            error={err('title')}
            hint="e.g. Bright 3-bedroom apartment near Lekki Phase 1"
          >
            {(a) => (
              <Input {...a} name="title" defaultValue={property?.title} maxLength={120} required />
            )}
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Property type" error={err('propertyType')}>
              {(a) => (
                <Select
                  {...a}
                  value={propertyType}
                  onChange={(e) => setPropertyType(e.target.value as PropertyType)}
                >
                  {Object.values(PropertyType).map((t) => (
                    <option key={t} value={t}>
                      {PROPERTY_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Listing purpose" error={err('listingType')}>
              {(a) => (
                <Select
                  {...a}
                  value={listingType}
                  onChange={(e) => setListingType(e.target.value as ListingType)}
                >
                  <option value="RENT">For rent</option>
                  <option value="SALE">For sale</option>
                </Select>
              )}
            </Field>
          </div>
          <Field
            label="Description"
            error={err('description')}
            hint="What makes it special? Mention the neighbourhood, access and power/water situation."
          >
            {(a) => (
              <Textarea
                {...a}
                name="description"
                defaultValue={property?.description ?? ''}
                rows={6}
                maxLength={5000}
              />
            )}
          </Field>
        </Section>

        <Section
          id="location"
          title="Location"
          description="Click the map to place the pin, or drag it to adjust."
        >
          <Field label="Street address" error={err('addressLine')}>
            {(a) => (
              <Input
                {...a}
                name="addressLine"
                defaultValue={property?.addressLine ?? ''}
                autoComplete="street-address"
              />
            )}
          </Field>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="City / town" error={err('city')}>
              {(a) => <Input {...a} name="city" defaultValue={property?.city ?? ''} />}
            </Field>
            <Field label="LGA" error={err('lga')}>
              {(a) => <Input {...a} name="lga" defaultValue={property?.lga ?? ''} />}
            </Field>
            <Field label="State" error={err('state')}>
              {(a) => (
                <Select {...a} name="state" defaultValue={property?.state ?? ''}>
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
          <div>
            <div className="h-72 overflow-hidden rounded-control border border-border">
              <LocationMap
                latitude={point.lat}
                longitude={point.lng}
                onPick={locked ? undefined : (lat, lng) => setPoint({ lat, lng })}
              />
            </div>
            <p
              className={cn(
                'mt-2 text-xs',
                err('latitude') || err('longitude') ? 'text-error' : 'text-text-muted',
              )}
            >
              {err('latitude') ??
                err('longitude') ??
                (point.lat !== null
                  ? `Pinned at ${point.lat.toFixed(5)}, ${point.lng!.toFixed(5)}`
                  : 'No location pinned yet.')}
            </p>
          </div>
        </Section>

        <Section id="details" title="Property details">
          <div className="grid gap-5 sm:grid-cols-3">
            {residential && (
              <>
                <Field label="Bedrooms" error={err('bedrooms')}>
                  {(a) => (
                    <Input
                      {...a}
                      name="bedrooms"
                      type="number"
                      min={0}
                      max={50}
                      defaultValue={property?.bedrooms ?? ''}
                    />
                  )}
                </Field>
                <Field label="Bathrooms" error={err('bathrooms')}>
                  {(a) => (
                    <Input
                      {...a}
                      name="bathrooms"
                      type="number"
                      min={0}
                      max={50}
                      defaultValue={property?.bathrooms ?? ''}
                    />
                  )}
                </Field>
                <Field label="Toilets" optional error={err('toilets')}>
                  {(a) => (
                    <Input
                      {...a}
                      name="toilets"
                      type="number"
                      min={0}
                      max={50}
                      defaultValue={property?.toilets ?? ''}
                    />
                  )}
                </Field>
              </>
            )}
            <Field label="Size (m²)" optional error={err('sizeSqm')}>
              {(a) => (
                <Input
                  {...a}
                  name="sizeSqm"
                  type="number"
                  min={1}
                  defaultValue={property?.sizeSqm ?? ''}
                />
              )}
            </Field>
            <Field label="Parking spaces" optional error={err('parkingSpaces')}>
              {(a) => (
                <Input
                  {...a}
                  name="parkingSpaces"
                  type="number"
                  min={0}
                  defaultValue={property?.parkingSpaces ?? ''}
                />
              )}
            </Field>
            <Field label="Available from" optional error={err('availableFrom')}>
              {(a) => (
                <Input
                  {...a}
                  name="availableFrom"
                  type="date"
                  defaultValue={property?.availableFrom ?? ''}
                />
              )}
            </Field>
          </div>
          {residential && (
            <div className="flex flex-wrap gap-6">
              <Check name="furnished" label="Furnished" defaultChecked={property?.furnished} />
              <Check name="serviced" label="Serviced" defaultChecked={property?.serviced} />
            </div>
          )}
        </Section>

        <Section id="pricing" title="Pricing" description="Enter amounts in naira.">
          <div className="grid gap-5 sm:grid-cols-2">
            {listingType === 'RENT' && (
              <Field label="Pricing period" error={err('pricingPeriod')}>
                {(a) => (
                  <Select
                    {...a}
                    value={period}
                    onChange={(e) => setPeriod(e.target.value as PricingPeriod)}
                  >
                    <option value="">Select</option>
                    {PERIODS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field
              label={listingType === 'SALE' ? 'Sale price (₦)' : 'Price (₦)'}
              error={err('priceKobo')}
            >
              {(a) => (
                <Input
                  {...a}
                  name="price"
                  inputMode="decimal"
                  defaultValue={naira(property?.priceKobo)}
                />
              )}
            </Field>
            {listingType === 'SALE' && (
              <p className="text-sm text-text-secondary sm:col-span-2">
                Sales don’t go through HavenHub. Signed-in buyers see your phone and email on the
                listing, with HavenHub’s notice that the deal is between you and them. They can also
                message you on HavenHub.
              </p>
            )}
            {listingType === 'RENT' && period === 'DAILY' && (
              <Field label="Maximum guests" error={err('maxGuests')}>
                {(a) => (
                  <Input
                    {...a}
                    name="maxGuests"
                    type="number"
                    min={1}
                    max={200}
                    defaultValue={property?.maxGuests ?? ''}
                  />
                )}
              </Field>
            )}
            {listingType === 'RENT' && (
              <Field
                label="Caution fee (₦)"
                optional
                hint="Refundable security deposit"
                error={err('cautionFeeKobo')}
              >
                {(a) => (
                  <Input
                    {...a}
                    name="cautionFee"
                    inputMode="decimal"
                    defaultValue={naira(property?.cautionFeeKobo)}
                  />
                )}
              </Field>
            )}
            <Field
              label="Discount (%)"
              optional
              hint="Shown on your listing; 1–90"
              error={err('discountPercent')}
            >
              {(a) => (
                <Input
                  {...a}
                  name="discountPercent"
                  type="number"
                  min={1}
                  max={90}
                  defaultValue={property?.discountPercent ?? ''}
                />
              )}
            </Field>
          </div>
        </Section>

        {listingType === 'RENT' && (
          <Section id="services" title="Cleaning & services">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Cleaning" error={err('cleaningOption')}>
                {(a) => (
                  <Select
                    {...a}
                    value={cleaning}
                    onChange={(e) => setCleaning(e.target.value as CleaningOption)}
                  >
                    <option value="">Select</option>
                    {Object.values(CleaningOption).map((o) => (
                      <option key={o} value={o}>
                        {CLEANING_LABELS[o]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {cleaning === 'AVAILABLE_FOR_FEE' && (
                <Field label="Cleaning fee (₦)" error={err('cleaningFeeKobo')}>
                  {(a) => (
                    <Input
                      {...a}
                      name="cleaningFee"
                      inputMode="decimal"
                      defaultValue={naira(property?.cleaningFeeKobo)}
                    />
                  )}
                </Field>
              )}
            </div>
            <p className="text-sm text-text-secondary">
              Food and hospitality options are listed under amenities below.
            </p>
          </Section>
        )}

        <Section
          id="amenities"
          title="Amenities"
          description="Choose everything guests or buyers can rely on."
        >
          {err('amenityIds') && <p className="text-sm text-error">{err('amenityIds')}</p>}
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
              {property ? 'Save changes' : 'Create draft'}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

function Section({
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

function Check({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-3 text-sm text-text">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="size-4 accent-primary"
      />
      {label}
    </label>
  );
}
