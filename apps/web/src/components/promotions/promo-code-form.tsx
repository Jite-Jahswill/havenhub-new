'use client';

import {
  MAX_PERCENT_OFF,
  createPromoCodeSchema,
  type AdminDiscountCodeDetail,
} from '@havenhub/shared';
import { Alert, Button, Card, CardBody, Field, Input, Select } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { api } from '@/lib/api/client';
import { formText } from '@/lib/form';
import { useApiAction } from '@/lib/use-api-action';

const number = (value: string) => (value === '' ? null : Number(value));
const instant = (value: string) => (value === '' ? null : new Date(value).toISOString());

/** An agent's promo code for their own rentals. The agent funds the discount. */
export function PromoCodeForm({ properties }: { properties: { id: string; title: string }[] }) {
  const router = useRouter();
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [kind, setKind] = useState<'percent' | 'amount'>('percent');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const value = number(formText(f, 'value'));
    const input = validate(createPromoCodeSchema, {
      code: formText(f, 'code'),
      description: formText(f, 'description'),
      percentOff: kind === 'percent' ? value : null,
      amountOffKobo: kind === 'amount' && value !== null ? Math.round(value * 100) : null,
      propertyIds: f.getAll('propertyIds').map(String),
      startsAt: instant(formText(f, 'startsAt')),
      endsAt: instant(formText(f, 'endsAt')),
      maxRedemptions: number(formText(f, 'maxRedemptions')),
      perUserLimit: number(formText(f, 'perUserLimit')) ?? 1,
    });
    if (!input) return;
    const created = await run(() =>
      api<AdminDiscountCodeDetail>('POST', '/agents/me/promo-codes', input),
    );
    if (created) router.push(`/agent/promotions/${created.id}`);
  }

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardBody className="flex flex-col gap-5">
          <Field
            label="Code"
            hint="What customers type when booking, e.g. WEEKEND10. Not case-sensitive."
            error={fieldErrors.code}
          >
            {(a) => (
              <Input {...a} name="code" maxLength={32} autoComplete="off" className="uppercase" />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type">
              {(a) => (
                <Select
                  {...a}
                  value={kind}
                  onChange={(e) => setKind(e.target.value as 'percent' | 'amount')}
                >
                  <option value="percent">Percentage off</option>
                  <option value="amount">Fixed amount off (₦)</option>
                </Select>
              )}
            </Field>
            <Field
              label={kind === 'percent' ? 'Percent off' : 'Amount off (₦)'}
              hint={
                kind === 'percent'
                  ? `1–${MAX_PERCENT_OFF}% of the rent, after any listing discount`
                  : 'Taken off the rent; it can never bring the rent below ₦100.'
              }
              error={fieldErrors.percentOff ?? fieldErrors.amountOffKobo}
            >
              {(a) => (
                <Input
                  {...a}
                  name="value"
                  type="number"
                  inputMode="decimal"
                  min={1}
                  max={kind === 'percent' ? MAX_PERCENT_OFF : undefined}
                  step={kind === 'percent' ? 1 : 0.01}
                />
              )}
            </Field>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-text">Properties</legend>
            <p className="text-xs text-text-muted">Leave all unticked for all your rentals.</p>
            {properties.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  name="propertyIds"
                  value={p.id}
                  className="size-4 accent-primary"
                />
                {p.title}
              </label>
            ))}
            {fieldErrors.propertyIds && (
              <p className="text-sm text-error">{fieldErrors.propertyIds}</p>
            )}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" optional error={fieldErrors.startsAt}>
              {(a) => <Input {...a} name="startsAt" type="datetime-local" />}
            </Field>
            <Field label="Ends" optional error={fieldErrors.endsAt}>
              {(a) => <Input {...a} name="endsAt" type="datetime-local" />}
            </Field>
            <Field
              label="Total uses"
              optional
              hint="Empty = unlimited."
              error={fieldErrors.maxRedemptions}
            >
              {(a) => <Input {...a} name="maxRedemptions" type="number" min={1} step={1} />}
            </Field>
            <Field label="Uses per customer" error={fieldErrors.perUserLimit}>
              {(a) => (
                <Input
                  {...a}
                  name="perUserLimit"
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  defaultValue={1}
                />
              )}
            </Field>
          </div>
          <Field label="Note to yourself" optional error={fieldErrors.description}>
            {(a) => <Input {...a} name="description" maxLength={300} />}
          </Field>
          <p className="text-xs text-text-muted">
            You fund the discount: it comes off your rent, and HavenHub’s fees are worked out on the
            discounted rent.
          </p>
        </CardBody>
      </Card>
      {error && error.code !== 'VALIDATION_ERROR' && <Alert tone="error">{error.message}</Alert>}
      {error?.code === 'VALIDATION_ERROR' && (
        <Alert tone="error">{error.message || 'Please check the highlighted fields.'}</Alert>
      )}
      <div>
        <Button type="submit" loading={pending}>
          Create code
        </Button>
      </div>
    </form>
  );
}

export function PromoCodeToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const { pending, error, run } = useApiAction();
  async function toggle() {
    if (await run(() => api('PATCH', `/agents/me/promo-codes/${id}`, { active: !active }))) {
      router.refresh();
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <Button variant="secondary" onClick={() => void toggle()} loading={pending}>
        {active ? 'Switch off' : 'Switch on'}
      </Button>
      {error && <Alert tone="error">{error.message}</Alert>}
    </div>
  );
}
