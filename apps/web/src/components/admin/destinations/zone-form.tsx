'use client';

import {
  ErrorCode,
  createVacationZoneSchema,
  nairaToKobo,
  updateVacationZoneSchema,
  type AdminVacationZoneView,
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
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { api } from '@/lib/api/client';
import { formText } from '@/lib/form';
import { NIGERIAN_STATES } from '@/lib/labels';
import { useApiAction } from '@/lib/use-api-action';

const naira = (kobo: number | null | undefined) =>
  kobo === null || kobo === undefined ? '' : String(kobo / 100);
const lines = (value: string) =>
  value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

/** Destination content (§23). The price range is indicative, never a charge. */
export function ZoneForm({ zone }: { zone?: AdminVacationZoneView }) {
  const router = useRouter();
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const text = (name: string) => formText(form, name) || null;
    const money = (name: string) => {
      const value = formText(form, name).replace(/,/g, '');
      return value === '' ? null : nairaToKobo(Number(value));
    };
    const values = {
      name: formText(form, 'name'),
      state: text('state'),
      description: text('description'),
      accommodation: text('accommodation'),
      priceRangeMinKobo: money('priceMin'),
      priceRangeMaxKobo: money('priceMax'),
      activities: lines(formText(form, 'activities')),
      offers: text('offers'),
      hospitality: text('hospitality'),
      nearbyAttractions: lines(formText(form, 'nearbyAttractions')),
      published: form.get('published') === 'on',
      sortOrder: Number(formText(form, 'sortOrder') || 0),
    };
    if (zone) {
      const input = validate(updateVacationZoneSchema, values);
      if (!input) return;
      const done = await run(() =>
        api<AdminVacationZoneView>('PATCH', `/admin/vacation-zones/${zone.id}`, input),
      );
      if (done) {
        setSaved(true);
        router.refresh();
      }
    } else {
      const input = validate(createVacationZoneSchema, values);
      if (!input) return;
      const done = await run(() =>
        api<AdminVacationZoneView>('POST', '/admin/vacation-zones', input),
      );
      if (done) router.push(`/admin/destinations/${done.id}?created=1`);
    }
  }

  const err = (name: string) => fieldErrors[name];
  return (
    <form method="post" onSubmit={onSubmit} noValidate>
      <Card>
        <CardHeader title="Destination" />
        <CardBody className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Name" error={err('name')}>
              {(a) => <Input {...a} name="name" maxLength={120} defaultValue={zone?.name} />}
            </Field>
            <Field label="State" optional error={err('state')}>
              {(a) => (
                <Select {...a} name="state" defaultValue={zone?.state ?? ''}>
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
          <Field label="Description" optional error={err('description')}>
            {(a) => (
              <Textarea
                {...a}
                name="description"
                rows={5}
                maxLength={5000}
                defaultValue={zone?.description ?? ''}
              />
            )}
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Activities" optional hint="One per line" error={err('activities')}>
              {(a) => (
                <Textarea
                  {...a}
                  name="activities"
                  rows={4}
                  defaultValue={zone?.activities.join('\n') ?? ''}
                />
              )}
            </Field>
            <Field
              label="Nearby attractions"
              optional
              hint="One per line"
              error={err('nearbyAttractions')}
            >
              {(a) => (
                <Textarea
                  {...a}
                  name="nearbyAttractions"
                  rows={4}
                  defaultValue={zone?.nearbyAttractions.join('\n') ?? ''}
                />
              )}
            </Field>
          </div>
          <Field label="Accommodation" optional error={err('accommodation')}>
            {(a) => (
              <Textarea
                {...a}
                name="accommodation"
                rows={3}
                maxLength={2000}
                defaultValue={zone?.accommodation ?? ''}
              />
            )}
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Hospitality" optional error={err('hospitality')}>
              {(a) => (
                <Textarea
                  {...a}
                  name="hospitality"
                  rows={3}
                  maxLength={2000}
                  defaultValue={zone?.hospitality ?? ''}
                />
              )}
            </Field>
            <Field label="Offers" optional error={err('offers')}>
              {(a) => (
                <Textarea
                  {...a}
                  name="offers"
                  rows={3}
                  maxLength={2000}
                  defaultValue={zone?.offers ?? ''}
                />
              )}
            </Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Typical price from (₦)" optional error={err('priceRangeMinKobo')}>
              {(a) => (
                <Input
                  {...a}
                  name="priceMin"
                  inputMode="decimal"
                  defaultValue={naira(zone?.priceRangeMinKobo)}
                />
              )}
            </Field>
            <Field label="Typical price to (₦)" optional error={err('priceRangeMaxKobo')}>
              {(a) => (
                <Input
                  {...a}
                  name="priceMax"
                  inputMode="decimal"
                  defaultValue={naira(zone?.priceRangeMaxKobo)}
                />
              )}
            </Field>
            <Field label="Display order" optional hint="Lower shows first" error={err('sortOrder')}>
              {(a) => (
                <Input
                  {...a}
                  name="sortOrder"
                  type="number"
                  min={0}
                  max={10000}
                  defaultValue={zone?.sortOrder ?? 0}
                />
              )}
            </Field>
          </div>
          <label className="flex items-center gap-3 text-sm text-text">
            <input
              type="checkbox"
              name="published"
              defaultChecked={zone?.published}
              className="size-4 accent-primary"
            />
            Published (visible on the Destinations page)
          </label>
          {error && error.code !== ErrorCode.VALIDATION_ERROR && (
            <Alert tone="error">{error.message}</Alert>
          )}
          {error?.code === ErrorCode.VALIDATION_ERROR && (
            <Alert tone="error">Please fix the highlighted fields.</Alert>
          )}
          {saved && <Alert tone="success">Saved.</Alert>}
          <div className="flex justify-end">
            <Button type="submit" loading={pending}>
              {zone ? 'Save changes' : 'Create destination'}
            </Button>
          </div>
        </CardBody>
      </Card>
    </form>
  );
}
