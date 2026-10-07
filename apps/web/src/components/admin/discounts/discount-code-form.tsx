'use client';

import {
  MAX_PERCENT_OFF,
  createDiscountCodeSchema,
  type AdminDiscountCodeDetail,
  type SubscriptionPlanView,
} from '@havenhub/shared';
import { Alert, Button, Card, CardBody, Field, Input, Select, Textarea } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { api } from '@/lib/api/client';
import { formText } from '@/lib/form';
import { useApiAction } from '@/lib/use-api-action';

const number = (value: string) => (value === '' ? null : Number(value));
/** `datetime-local` is the admin's local time; the API stores an instant. */
const instant = (value: string) => (value === '' ? null : new Date(value).toISOString());

export function DiscountCodeForm({ plans }: { plans: SubscriptionPlanView[] }) {
  const router = useRouter();
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [kind, setKind] = useState<'percent' | 'amount'>('percent');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const value = number(formText(f, 'value'));
    const emails = formText(f, 'agentEmails')
      .split(/[\s,;]+/)
      .filter(Boolean);
    const input = validate(createDiscountCodeSchema, {
      code: formText(f, 'code'),
      description: formText(f, 'description'),
      percentOff: kind === 'percent' ? value : null,
      // Naira in the form, kobo in the API.
      amountOffKobo: kind === 'amount' && value !== null ? Math.round(value * 100) : null,
      planIds: f.getAll('planIds').map(String),
      agentEmails: emails,
      startsAt: instant(formText(f, 'startsAt')),
      endsAt: instant(formText(f, 'endsAt')),
      maxRedemptions: number(formText(f, 'maxRedemptions')),
      perUserLimit: number(formText(f, 'perUserLimit')) ?? 1,
    });
    if (!input) return;
    const created = await run(() =>
      api<AdminDiscountCodeDetail>('POST', '/admin/discount-codes', input),
    );
    if (created) router.push(`/admin/discounts/${created.id}`);
  }

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardBody className="flex flex-col gap-5">
          <Field
            label="Code"
            hint="What agents type, e.g. AGENT10. Not case-sensitive."
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
                kind === 'percent' ? `1–${MAX_PERCENT_OFF}%` : 'The total can never go below ₦100.'
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
            <legend className="mb-1 text-sm font-medium text-text">Plans</legend>
            <p className="text-xs text-text-muted">Leave all unticked for every paid plan.</p>
            {plans
              .filter((p) => !p.isDefault)
              .map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    name="planIds"
                    value={p.id}
                    className="size-4 accent-primary"
                  />
                  {p.name}
                </label>
              ))}
            {fieldErrors.planIds && <p className="text-sm text-error">{fieldErrors.planIds}</p>}
          </fieldset>
          <Field
            label="Only for these agents"
            optional
            hint="Agent account emails, separated by commas or new lines. Empty = any agent."
            error={fieldErrors.agentEmails}
          >
            {(a) => <Textarea {...a} name="agentEmails" rows={3} />}
          </Field>
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
            <Field label="Uses per agent" error={fieldErrors.perUserLimit}>
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
          <Field
            label="Internal note"
            optional
            hint="Only administrators see this."
            error={fieldErrors.description}
          >
            {(a) => <Input {...a} name="description" maxLength={300} />}
          </Field>
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

/** Switch on/off and send to agents. */
export function DiscountCodeActions({ code }: { code: AdminDiscountCodeDetail }) {
  const router = useRouter();
  const { pending, error, run } = useApiAction();
  const [notice, setNotice] = useState<string | null>(null);
  const expired = code.endsAt !== null && new Date(code.endsAt) <= new Date();

  async function toggle() {
    setNotice(null);
    if (
      await run(() => api('PATCH', `/admin/discount-codes/${code.id}`, { active: !code.active }))
    ) {
      router.refresh();
    }
  }

  async function send() {
    setNotice(null);
    const who = code.agents.length
      ? `the ${code.agents.length} agent${code.agents.length === 1 ? '' : 's'} it is for`
      : 'every active agent';
    if (!window.confirm(`Send ${code.code} to ${who}?`)) return;
    const result = await run(() =>
      api<{ recipients: number }>('POST', `/admin/discount-codes/${code.id}/send`),
    );
    if (result)
      setNotice(`Sent to ${result.recipients} agent${result.recipients === 1 ? '' : 's'}.`);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => void send()} loading={pending} disabled={!code.active || expired}>
          Send to agents
        </Button>
        <Button variant="secondary" onClick={() => void toggle()} loading={pending}>
          {code.active ? 'Switch off' : 'Switch on'}
        </Button>
      </div>
      <p className="text-xs text-text-muted">
        Sending puts the code in the agents’ Notifications with a link that applies it at checkout.
      </p>
      {error && <Alert tone="error">{error.message}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
    </div>
  );
}
