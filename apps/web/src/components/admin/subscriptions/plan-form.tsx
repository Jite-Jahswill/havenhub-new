'use client';

import {
  ENTITLEMENTS,
  createSubscriptionPlanSchema,
  nairaToKobo,
  updateSubscriptionPlanSchema,
  type AdminSubscriptionPlanView,
  type EntitlementKey,
  type PlanEntitlements,
} from '@havenhub/shared';
import { Alert, Button, Field, Input, Select, Textarea } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { api } from '@/lib/api/client';
import { formText } from '@/lib/form';
import { useApiAction } from '@/lib/use-api-action';

/**
 * Create or edit a plan. Every limit is entered explicitly: a number (0 =
 * not included) or "Unlimited". The API validates the same shared schema.
 */
export function PlanForm({ plan }: { plan?: AdminSubscriptionPlanView }) {
  const router = useRouter();
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [saved, setSaved] = useState(false);
  const [unlimited, setUnlimited] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      ENTITLEMENTS.map((e) => [e.key, plan ? plan.entitlements[e.key] === null : false]),
    ),
  );
  const isDefault = plan?.isDefault ?? false;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const entitlements = Object.fromEntries(
      ENTITLEMENTS.map((e) => {
        if (unlimited[e.key]) return [e.key, null];
        const raw = formText(form, `limit.${e.key}`).trim();
        return [e.key, raw === '' ? Number.NaN : Number(raw)];
      }),
    ) as PlanEntitlements;
    const price = formText(form, 'price').replace(/,/g, '').trim();
    const values = {
      name: formText(form, 'name').trim(),
      description: formText(form, 'description').trim() || null,
      rank: Number(formText(form, 'rank') || '0'),
      features: formText(form, 'features')
        .split('\n')
        .map((f) => f.trim())
        .filter(Boolean),
      entitlements,
      ...(isDefault
        ? {}
        : {
            priceKobo:
              price === '' || !Number.isFinite(Number(price))
                ? Number.NaN
                : nairaToKobo(Number(price)),
            billingInterval: formText(form, 'billingInterval'),
          }),
    };

    if (plan) {
      const input = validate(updateSubscriptionPlanSchema, values);
      if (!input) return;
      const done = await run(() => api('PATCH', `/admin/subscription-plans/${plan.id}`, input));
      if (done) {
        setSaved(true);
        router.refresh();
      }
      return;
    }
    const input = validate(createSubscriptionPlanSchema, {
      ...values,
      slug: formText(form, 'slug').trim() || undefined,
      status: formText(form, 'status') || 'ACTIVE',
    });
    if (!input) return;
    const created = await run(() =>
      api<AdminSubscriptionPlanView>('POST', '/admin/subscription-plans', input),
    );
    if (created) router.push(`/admin/plans/${created.id}?created=1`);
  }

  const limitError = (key: EntitlementKey) => fieldErrors[`entitlements.${key}`];

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-8">
      {error && error.code !== 'VALIDATION_ERROR' && <Alert tone="error">{error.message}</Alert>}
      {error?.code === 'VALIDATION_ERROR' && (
        <Alert tone="error">Please fix the highlighted fields.</Alert>
      )}
      {saved && <Alert tone="success">Saved. Limit changes apply to every subscriber now.</Alert>}

      <section className="grid gap-5 sm:grid-cols-2" aria-label="Plan details">
        <Field label="Name" error={fieldErrors.name}>
          {(a) => <Input {...a} name="name" defaultValue={plan?.name} maxLength={60} required />}
        </Field>
        {!plan && (
          <Field
            label="Slug"
            optional
            hint="Used in links. Generated from the name if empty."
            error={fieldErrors.slug}
          >
            {(a) => <Input {...a} name="slug" maxLength={60} placeholder="starter" />}
          </Field>
        )}
        <Field
          label="Description"
          optional
          error={fieldErrors.description}
          className="sm:col-span-2"
        >
          {(a) => (
            <Textarea
              {...a}
              name="description"
              rows={2}
              maxLength={500}
              defaultValue={plan?.description ?? ''}
            />
          )}
        </Field>
        {isDefault ? (
          <p className="text-sm text-text-secondary sm:col-span-2">
            This is the free default plan every agent is on without a paid term. It has no price and
            is always offered; you can change its limits.
          </p>
        ) : (
          <>
            <Field
              label="Price (₦)"
              hint="Charged per billing interval"
              error={fieldErrors.priceKobo}
            >
              {(a) => (
                <Input
                  {...a}
                  name="price"
                  inputMode="decimal"
                  defaultValue={plan ? String(plan.priceKobo / 100) : ''}
                  required
                />
              )}
            </Field>
            <Field label="Billing interval" error={fieldErrors.billingInterval}>
              {(a) => (
                <Select
                  {...a}
                  name="billingInterval"
                  defaultValue={plan?.billingInterval ?? 'MONTHLY'}
                >
                  <option value="MONTHLY">Monthly</option>
                  <option value="YEARLY">Yearly</option>
                </Select>
              )}
            </Field>
          </>
        )}
        <Field
          label="Tier rank"
          hint="Higher rank = upgrade (starts now); lower or equal = downgrade (starts at period end)."
          error={fieldErrors.rank}
        >
          {(a) => (
            <Input
              {...a}
              name="rank"
              type="number"
              min={0}
              max={1000}
              defaultValue={plan?.rank ?? 1}
            />
          )}
        </Field>
        {!plan && (
          <Field label="Availability" error={fieldErrors.status}>
            {(a) => (
              <Select {...a} name="status" defaultValue="ACTIVE">
                <option value="ACTIVE">Offer to agents now</option>
                <option value="INACTIVE">Save without offering</option>
              </Select>
            )}
          </Field>
        )}
        <Field
          label="Selling points"
          optional
          hint="One per line, up to 8. Shown on the comparison page."
          error={fieldErrors.features}
          className="sm:col-span-2"
        >
          {(a) => (
            <Textarea
              {...a}
              name="features"
              rows={3}
              defaultValue={plan?.features.join('\n') ?? ''}
            />
          )}
        </Field>
      </section>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-base font-semibold text-text">Limits</legend>
        <p className="text-sm text-text-secondary">
          Enter 0 for &ldquo;not included&rdquo;. Lowering a limit never deletes anything: agents
          above it keep what they have but cannot add more.
        </p>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {ENTITLEMENTS.map((e) => (
            <div key={e.key} className="flex flex-col gap-2">
              <Field
                label={`${e.label}${e.unit === 'MB' ? ' (MB)' : ''}`}
                hint={e.enforced ? undefined : 'For a feature that is not live yet'}
                error={limitError(e.key)}
              >
                {(a) => (
                  <Input
                    {...a}
                    name={`limit.${e.key}`}
                    type="number"
                    min={0}
                    disabled={unlimited[e.key]}
                    defaultValue={
                      plan && plan.entitlements[e.key] !== null
                        ? String(plan.entitlements[e.key])
                        : plan
                          ? ''
                          : '0'
                    }
                  />
                )}
              </Field>
              <label className="flex items-center gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  checked={unlimited[e.key] ?? false}
                  onChange={(ev) => setUnlimited((u) => ({ ...u, [e.key]: ev.target.checked }))}
                  className="size-4 accent-primary"
                />
                Unlimited<span className="sr-only"> {e.label.toLowerCase()}</span>
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <div>
        <Button type="submit" loading={pending}>
          {plan ? 'Save changes' : 'Create plan'}
        </Button>
      </div>
    </form>
  );
}
