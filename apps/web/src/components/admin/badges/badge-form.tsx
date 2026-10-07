'use client';

import {
  createBadgeSchema,
  updateBadgeSchema,
  type AdminBadgeDetail,
  type BadgeMode,
  type CmsImage,
} from '@havenhub/shared';
import { Alert, Button, Card, CardBody, Field, Input, Select } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { ImageField } from '@/components/admin/cms/image-field';
import { api } from '@/lib/api/client';
import { formText } from '@/lib/form';
import { useApiAction } from '@/lib/use-api-action';

const number = (v: string) => (v === '' ? null : Number(v));

export function BadgeForm({
  badge,
  canUpload,
}: {
  badge: AdminBadgeDetail | null;
  canUpload: boolean;
}) {
  const router = useRouter();
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [image, setImage] = useState<CmsImage | null>(badge?.image ?? null);
  const [mode, setMode] = useState<BadgeMode>(badge?.mode ?? 'AUTOMATIC');
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const f = new FormData(event.currentTarget);
    const auto = mode === 'AUTOMATIC';
    const values = {
      name: formText(f, 'name'),
      description: formText(f, 'description') || null,
      imageId: image?.id ?? '',
      mode,
      minRating: auto ? number(formText(f, 'minRating')) : null,
      minReviews: auto ? number(formText(f, 'minReviews')) : null,
      minCompletedBookings: auto ? number(formText(f, 'minCompletedBookings')) : null,
      active: f.get('active') === 'on',
      sortOrder: number(formText(f, 'sortOrder')) ?? 0,
    };
    const input = validate(badge ? updateBadgeSchema : createBadgeSchema, values);
    if (!input) return;
    const result = await run(() =>
      badge
        ? api<AdminBadgeDetail>('PATCH', `/admin/badges/${badge.id}`, input)
        : api<AdminBadgeDetail>('POST', '/admin/badges', input),
    );
    if (!result) return;
    if (badge) {
      setSaved(true);
      router.refresh();
    } else router.push(`/admin/badges/${result.id}`);
  }

  async function onDelete() {
    if (!badge || !window.confirm(`Delete “${badge.name}”? It is removed from every property.`)) {
      return;
    }
    if (await run(() => api('DELETE', `/admin/badges/${badge.id}`))) router.push('/admin/badges');
  }

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardBody className="flex flex-col gap-5">
          <Field
            label="Name"
            hint="Shown next to the badge, e.g. Award winning."
            error={fieldErrors.name}
          >
            {(a) => <Input {...a} name="name" defaultValue={badge?.name} maxLength={60} />}
          </Field>
          <Field
            label="Description"
            optional
            hint="Shown on hover."
            error={fieldErrors.description}
          >
            {(a) => (
              <Input
                {...a}
                name="description"
                defaultValue={badge?.description ?? ''}
                maxLength={200}
              />
            )}
          </Field>
          <ImageField label="Badge image" value={image} onChange={setImage} canUpload={canUpload} />
          <p className="-mt-3 text-xs text-text-muted">
            Upload your design in Media (a square PNG with a transparent background works best). It
            is shown small, so keep it simple.
          </p>
          {fieldErrors.imageId && <p className="text-sm text-error">{fieldErrors.imageId}</p>}
          <Field label="How properties get it">
            {(a) => (
              <Select {...a} value={mode} onChange={(e) => setMode(e.target.value as BadgeMode)}>
                <option value="AUTOMATIC">Automatically, when they meet the rules</option>
                <option value="MANUAL">Only when an administrator gives it</option>
              </Select>
            )}
          </Field>
          {mode === 'AUTOMATIC' && (
            <fieldset className="grid gap-4 rounded-control border border-border p-4 sm:grid-cols-3">
              <legend className="px-1 text-sm font-medium text-text">
                Rules (all that are set must hold)
              </legend>
              <Field
                label="Stars at least"
                optional
                hint="1.0–5.0, e.g. 5 or 4.8"
                error={fieldErrors.minRating}
              >
                {(a) => (
                  <Input
                    {...a}
                    name="minRating"
                    type="number"
                    min={1}
                    max={5}
                    step={0.1}
                    defaultValue={badge?.minRating ?? ''}
                  />
                )}
              </Field>
              <Field label="Reviews at least" optional error={fieldErrors.minReviews}>
                {(a) => (
                  <Input
                    {...a}
                    name="minReviews"
                    type="number"
                    min={0}
                    step={1}
                    defaultValue={badge?.minReviews ?? ''}
                  />
                )}
              </Field>
              <Field
                label="Completed stays at least"
                optional
                error={fieldErrors.minCompletedBookings}
              >
                {(a) => (
                  <Input
                    {...a}
                    name="minCompletedBookings"
                    type="number"
                    min={0}
                    step={1}
                    defaultValue={badge?.minCompletedBookings ?? ''}
                  />
                )}
              </Field>
            </fieldset>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Order"
              hint="Lower shows first when a property has several."
              error={fieldErrors.sortOrder}
            >
              {(a) => (
                <Input
                  {...a}
                  name="sortOrder"
                  type="number"
                  min={0}
                  max={1000}
                  defaultValue={badge?.sortOrder ?? 0}
                />
              )}
            </Field>
          </div>
          <label className="flex items-start gap-3 text-sm text-text">
            <input
              type="checkbox"
              name="active"
              defaultChecked={badge?.active ?? true}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              Shown on the site
              <span className="block text-text-muted">
                Off: hidden everywhere; awards are kept.
              </span>
            </span>
          </label>
        </CardBody>
      </Card>
      {error && error.code !== 'VALIDATION_ERROR' && <Alert tone="error">{error.message}</Alert>}
      {error?.code === 'VALIDATION_ERROR' && (
        <Alert tone="error">{error.message || 'Please check the highlighted fields.'}</Alert>
      )}
      {saved && <Alert tone="success">Saved. Properties were re-checked against the rules.</Alert>}
      <div className="flex gap-3">
        <Button type="submit" loading={pending}>
          {badge ? 'Save' : 'Create badge'}
        </Button>
        {badge && (
          <Button type="button" variant="danger" onClick={() => void onDelete()} disabled={pending}>
            Delete
          </Button>
        )}
      </div>
    </form>
  );
}

/** Give the badge to a property by hand, or take a given one back. */
export function BadgeHolders({ badge }: { badge: AdminBadgeDetail }) {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useApiAction();
  const [property, setProperty] = useState('');

  async function give(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await run(() => api('POST', `/admin/badges/${badge.id}/properties`, { property }))) {
      setProperty('');
      router.refresh();
    }
  }
  async function takeBack(propertyId: string) {
    if (await run(() => api('DELETE', `/admin/badges/${badge.id}/properties/${propertyId}`))) {
      router.refresh();
    }
  }

  return (
    <section aria-labelledby="holders" className="flex max-w-3xl flex-col gap-4">
      <h2 id="holders" className="text-lg font-semibold text-text">
        Properties with this badge ({badge.holders})
      </h2>
      <form onSubmit={give} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field
          label="Give it to a property"
          hint="Paste the property's page address or slug."
          error={fieldErrors.property}
        >
          {(a) => (
            <Input
              {...a}
              value={property}
              onChange={(e) => setProperty(e.target.value)}
              placeholder="/properties/…"
            />
          )}
        </Field>
        <Button type="submit" variant="secondary" loading={pending} disabled={!property.trim()}>
          Give badge
        </Button>
      </form>
      {error && error.code !== 'VALIDATION_ERROR' && <Alert tone="error">{error.message}</Alert>}
      <ul className="flex flex-col divide-y divide-border rounded-card border border-border">
        {badge.properties.length === 0 && (
          <li className="p-4 text-sm text-text-secondary">No property has it yet.</li>
        )}
        {badge.properties.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <span>
              <a href={`/properties/${p.slug}`} className="font-medium text-text hover:underline">
                {p.title}
              </a>
              <span className="block text-xs text-text-muted">
                {p.source === 'MANUAL' ? 'Given by an administrator' : 'Earned'}
                {p.rating ? ` · ★ ${p.rating.average.toFixed(1)} (${p.rating.count})` : ''}
                {` · ${p.completedBookings} completed stays`}
              </span>
            </span>
            {p.source === 'MANUAL' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void takeBack(p.id)}
                disabled={pending}
              >
                Take back
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
