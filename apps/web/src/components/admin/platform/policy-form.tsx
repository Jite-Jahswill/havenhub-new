'use client';

import {
  POLICY_AREA_META,
  POLICY_DEFAULTS,
  updatePlatformPoliciesSchema,
  type PolicyArea,
} from '@havenhub/shared';
import { Alert, Button, Card, CardBody, Field, Input, Textarea } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { api } from '@/lib/api/client';
import { formText } from '@/lib/form';
import { useApiAction } from '@/lib/use-api-action';

/**
 * One policy area, rendered from the shared field metadata so a new setting
 * needs no new form code. Empty nullable numbers mean "server default".
 */
export function PolicyForm({ area, values }: { area: PolicyArea; values: object }) {
  const router = useRouter();
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [saved, setSaved] = useState(false);
  const current = values as Record<string, boolean | number | string | null>;
  const defaults = POLICY_DEFAULTS[area] as Record<string, boolean | number | string | null>;
  const fields = POLICY_AREA_META[area].fields;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const f = new FormData(event.currentTarget);
    const patch: Record<string, boolean | number | string | null> = {};
    for (const field of fields) {
      if (field.type === 'boolean') {
        patch[field.key] = f.get(field.key) === 'on';
      } else if (field.type === 'text') {
        patch[field.key] = formText(f, field.key) || null;
      } else {
        const raw = formText(f, field.key);
        // Empty: "server default" where allowed; otherwise left for the schema to reject.
        patch[field.key] = raw === '' ? (field.defaultLabel ? null : Number.NaN) : Number(raw);
      }
    }
    const input = validate(updatePlatformPoliciesSchema, { [area]: patch });
    if (!input) return;
    if (await run(() => api('PATCH', '/admin/settings/policies', input))) {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <Card>
        <CardBody className="flex flex-col gap-6">
          {fields.map((field) =>
            field.type === 'boolean' ? (
              <label key={field.key} className="flex items-start gap-3 text-sm text-text">
                <input
                  type="checkbox"
                  name={field.key}
                  defaultChecked={current[field.key] === true}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  {field.label}
                  <span className="block text-text-muted">{field.help}</span>
                </span>
              </label>
            ) : field.type === 'text' ? (
              <Field
                key={field.key}
                label={field.label}
                optional
                hint={field.help}
                error={fieldErrors[`${area}.${field.key}`]}
              >
                {(a) => (
                  <Textarea
                    {...a}
                    name={field.key}
                    rows={6}
                    maxLength={field.max}
                    defaultValue={(current[field.key] as string | null) ?? ''}
                  />
                )}
              </Field>
            ) : (
              <Field
                key={field.key}
                label={`${field.label} (${field.unit})`}
                optional={Boolean(field.defaultLabel)}
                hint={`${field.help} Allowed: ${field.min}–${field.max}. Default: ${
                  defaults[field.key] ?? field.defaultLabel
                }.`}
                error={fieldErrors[`${area}.${field.key}`]}
              >
                {(a) => (
                  <Input
                    {...a}
                    type="number"
                    inputMode="numeric"
                    name={field.key}
                    min={field.min}
                    max={field.max}
                    step={1}
                    placeholder={field.defaultLabel}
                    defaultValue={current[field.key] === null ? '' : String(current[field.key])}
                    className="max-w-40"
                  />
                )}
              </Field>
            ),
          )}
        </CardBody>
      </Card>
      {error && error.code !== 'VALIDATION_ERROR' && <Alert tone="error">{error.message}</Alert>}
      {error?.code === 'VALIDATION_ERROR' && (
        <Alert tone="error">Please check the highlighted fields.</Alert>
      )}
      {saved && <Alert tone="success">Saved. The change applies immediately, everywhere.</Alert>}
      <div>
        <Button type="submit" loading={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}
