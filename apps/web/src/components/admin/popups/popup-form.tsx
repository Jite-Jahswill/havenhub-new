'use client';

import {
  POPUP_AUDIENCE_LABELS,
  POPUP_FREQUENCY_LABELS,
  POPUP_KIND_LABELS,
  PopupAudience,
  PopupFrequency,
  PopupKind,
  createPopupSchema,
  updatePopupSchema,
  type AdminPopupView,
  type CmsImage,
} from '@havenhub/shared';
import { Alert, Button, Card, CardBody, Field, Input, Select, Textarea } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { ImageField } from '@/components/admin/cms/image-field';
import { PopupContent } from '@/components/popups/popup-content';
import { api } from '@/lib/api/client';
import { formText } from '@/lib/form';
import { useApiAction } from '@/lib/use-api-action';

type Placement = 'ALL' | 'HOME' | 'PATHS';

/** `datetime-local` value (admin's local time) ⇄ ISO instant. */
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (value: string) => (value ? new Date(value).toISOString() : null);

export function PopupForm({
  popup,
  canUpload,
}: {
  popup: AdminPopupView | null;
  canUpload: boolean;
}) {
  const router = useRouter();
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [saved, setSaved] = useState(false);
  const [kind, setKind] = useState<PopupKind>(popup?.kind ?? 'ANNOUNCEMENT');
  const [title, setTitle] = useState(popup?.title ?? '');
  const [body, setBody] = useState(popup?.body ?? '');
  const [image, setImage] = useState<CmsImage | null>(popup?.image ?? null);
  const [discountCode, setDiscountCode] = useState(popup?.discountCode ?? '');
  const [ctaLabel, setCtaLabel] = useState(popup?.ctaLabel ?? '');
  const [ctaLink, setCtaLink] = useState(popup?.ctaLink ?? '');
  const initialPlacement: Placement = !popup?.paths.length
    ? 'ALL'
    : popup.paths.length === 1 && popup.paths[0] === '/'
      ? 'HOME'
      : 'PATHS';
  const [placement, setPlacement] = useState<Placement>(initialPlacement);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const f = new FormData(event.currentTarget);
    const text = (name: string) => formText(f, name);
    const paths =
      placement === 'ALL'
        ? []
        : placement === 'HOME'
          ? ['/']
          : text('paths')
              .split(/[\s,]+/)
              .filter(Boolean);
    const values = {
      name: text('name'),
      kind,
      title: title.trim(),
      body: body.trim() || null,
      imageId: image?.id ?? null,
      property: kind === 'PROPERTY' ? text('property') || null : null,
      discountCode: discountCode.trim() || null,
      ctaLabel: ctaLabel.trim() || null,
      ctaLink: ctaLink.trim() || null,
      audience: text('audience'),
      paths,
      frequency: text('frequency'),
      delaySeconds: Number(text('delaySeconds') || 0),
      priority: Number(text('priority') || 0),
      active: f.get('active') === 'on',
      startsAt: fromLocal(text('startsAt')),
      endsAt: fromLocal(text('endsAt')),
    };
    const input = validate(popup ? updatePopupSchema : createPopupSchema, values);
    if (!input) return;
    const result = await run(() =>
      popup
        ? api<AdminPopupView>('PATCH', `/admin/popups/${popup.id}`, input)
        : api<AdminPopupView>('POST', '/admin/popups', input),
    );
    if (!result) return;
    if (popup) {
      setSaved(true);
      router.refresh();
    } else {
      router.push(`/admin/popups/${result.id}`);
    }
  }

  async function onDelete() {
    if (!popup || !window.confirm(`Delete “${popup.name}”? This cannot be undone.`)) return;
    if (await run(() => api('DELETE', `/admin/popups/${popup.id}`))) router.push('/admin/popups');
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
      <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <Card>
          <CardBody className="flex flex-col gap-5">
            <Field label="Name" hint="Only administrators see this." error={fieldErrors.name}>
              {(a) => <Input {...a} name="name" defaultValue={popup?.name} maxLength={120} />}
            </Field>
            <Field label="Type" error={fieldErrors.kind}>
              {(a) => (
                <Select {...a} value={kind} onChange={(e) => setKind(e.target.value as PopupKind)}>
                  {Object.values(PopupKind).map((k) => (
                    <option key={k} value={k}>
                      {POPUP_KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Title" error={fieldErrors.title}>
              {(a) => (
                <Input
                  {...a}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                />
              )}
            </Field>
            <Field label="Message" optional error={fieldErrors.body}>
              {(a) => (
                <Textarea
                  {...a}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={4}
                  maxLength={600}
                />
              )}
            </Field>
            <ImageField
              label="Image (optional)"
              value={image}
              onChange={setImage}
              canUpload={canUpload}
            />
            {fieldErrors.imageId && <p className="text-sm text-error">{fieldErrors.imageId}</p>}
            {kind === 'PROPERTY' && (
              <Field
                label="Property"
                hint="Paste the property's page address or its slug. The pop-up only shows while the property is published."
                error={fieldErrors.property}
              >
                {(a) => (
                  <Input
                    {...a}
                    name="property"
                    defaultValue={popup?.propertySlug ?? ''}
                    placeholder="/properties/…"
                  />
                )}
              </Field>
            )}
            <Field
              label="Discount code"
              optional
              hint="Shown with a copy button. Create the code under Discounts (or ask the agent) first."
              error={fieldErrors.discountCode}
            >
              {(a) => (
                <Input
                  {...a}
                  value={discountCode}
                  onChange={(e) => setDiscountCode(e.target.value)}
                  maxLength={32}
                  className="uppercase"
                />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Button text" optional error={fieldErrors.ctaLabel}>
                {(a) => (
                  <Input
                    {...a}
                    value={ctaLabel}
                    onChange={(e) => setCtaLabel(e.target.value)}
                    maxLength={40}
                  />
                )}
              </Field>
              <Field
                label="Button link"
                optional
                hint="A page on HavenHub, e.g. /properties"
                error={fieldErrors.ctaLink}
              >
                {(a) => (
                  <Input
                    {...a}
                    value={ctaLink}
                    onChange={(e) => setCtaLink(e.target.value)}
                    maxLength={500}
                  />
                )}
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-col gap-5">
            <h2 className="font-semibold text-text">Who, where and when</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Show to" error={fieldErrors.audience}>
                {(a) => (
                  <Select {...a} name="audience" defaultValue={popup?.audience ?? 'ALL'}>
                    {Object.values(PopupAudience).map((v) => (
                      <option key={v} value={v}>
                        {POPUP_AUDIENCE_LABELS[v]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="How often" error={fieldErrors.frequency}>
                {(a) => (
                  <Select {...a} name="frequency" defaultValue={popup?.frequency ?? 'ONCE'}>
                    {Object.values(PopupFrequency).map((v) => (
                      <option key={v} value={v}>
                        {POPUP_FREQUENCY_LABELS[v]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <fieldset className="flex flex-col gap-2 text-sm text-text">
              <legend className="mb-1 font-medium">Pages</legend>
              {(
                [
                  ['ALL', 'All public pages'],
                  ['HOME', 'Homepage only'],
                  ['PATHS', 'Chosen sections'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="placement"
                    checked={placement === value}
                    onChange={() => setPlacement(value)}
                    className="size-4 accent-primary"
                  />
                  {label}
                </label>
              ))}
              {placement === 'PATHS' && (
                <Field
                  label="Sections"
                  hint="One per line, e.g. /properties or /events. Each includes the pages below it. /agent shows it in the agent dashboard."
                  error={fieldErrors.paths}
                >
                  {(a) => (
                    <Textarea
                      {...a}
                      name="paths"
                      rows={3}
                      defaultValue={initialPlacement === 'PATHS' ? popup!.paths.join('\n') : ''}
                    />
                  )}
                </Field>
              )}
              <p className="text-xs text-text-muted">
                Never shown on admin, sign-in or payment pages. Each visitor sees at most one pop-up
                per visit.
              </p>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts" optional error={fieldErrors.startsAt}>
                {(a) => (
                  <Input
                    {...a}
                    name="startsAt"
                    type="datetime-local"
                    defaultValue={toLocal(popup?.startsAt ?? null)}
                  />
                )}
              </Field>
              <Field label="Ends" optional error={fieldErrors.endsAt}>
                {(a) => (
                  <Input
                    {...a}
                    name="endsAt"
                    type="datetime-local"
                    defaultValue={toLocal(popup?.endsAt ?? null)}
                  />
                )}
              </Field>
              <Field label="Delay (seconds)" hint="0–60" error={fieldErrors.delaySeconds}>
                {(a) => (
                  <Input
                    {...a}
                    name="delaySeconds"
                    type="number"
                    min={0}
                    max={60}
                    defaultValue={popup?.delaySeconds ?? 2}
                  />
                )}
              </Field>
              <Field
                label="Priority"
                hint="Higher shows first when several apply."
                error={fieldErrors.priority}
              >
                {(a) => (
                  <Input
                    {...a}
                    name="priority"
                    type="number"
                    min={-100}
                    max={100}
                    defaultValue={popup?.priority ?? 0}
                  />
                )}
              </Field>
            </div>
            <label className="flex items-start gap-3 text-sm text-text">
              <input
                type="checkbox"
                name="active"
                defaultChecked={popup?.active ?? false}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                Live
                <span className="block text-text-muted">Off: saved but never shown.</span>
              </span>
            </label>
          </CardBody>
        </Card>

        {error && error.code !== 'VALIDATION_ERROR' && <Alert tone="error">{error.message}</Alert>}
        {error?.code === 'VALIDATION_ERROR' && (
          <Alert tone="error">{error.message || 'Please check the highlighted fields.'}</Alert>
        )}
        {saved && <Alert tone="success">Saved. Changes reach the site within a minute.</Alert>}
        <div className="flex gap-3">
          <Button type="submit" loading={pending}>
            {popup ? 'Save' : 'Create pop-up'}
          </Button>
          {popup && (
            <Button
              type="button"
              variant="danger"
              onClick={() => void onDelete()}
              disabled={pending}
            >
              Delete
            </Button>
          )}
        </div>
      </form>

      <aside aria-label="Preview" className="xl:sticky xl:top-6 xl:self-start">
        <p className="mb-2 text-sm font-medium text-text-secondary">Preview</p>
        <div className="overflow-hidden rounded-card border border-border bg-surface shadow-raised">
          <PopupContent
            popup={{
              kind,
              title: title || 'Your title',
              body: body || null,
              image,
              property: kind === 'PROPERTY' ? (popup?.property ?? null) : null,
              discountCode: discountCode.trim().toUpperCase() || null,
              ctaLabel: ctaLabel || null,
              ctaLink: ctaLink || null,
            }}
          />
        </div>
        {kind === 'PROPERTY' && !popup?.property && (
          <p className="mt-2 text-xs text-text-muted">The property card appears after saving.</p>
        )}
      </aside>
    </div>
  );
}
