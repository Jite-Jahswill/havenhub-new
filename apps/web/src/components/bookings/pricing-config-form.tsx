'use client';

import { ErrorCode, pricingConfigSchema, type PricingConfigView } from '@havenhub/shared';
import { Alert, Button, Field, Input } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { api } from '@/lib/api/client';
import { useApiAction } from '@/lib/use-api-action';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** "7.5" → 750 basis points, without floating-point drift. */
function percentToBps(value: string): number | null {
  const match = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

export function PricingConfigForm({ current }: { current: PricingConfigView | null }) {
  const router = useRouter();
  const { pending, error, fieldErrors, validate, run, setError } = useApiAction();
  const [saved, setSaved] = useState(false);
  const pct = (bps: number | undefined) => (bps === undefined ? '' : String(bps / 100));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const rates = {
      serviceFeeBps: percentToBps(text(form, 'serviceFee')),
      agentCommissionBps: percentToBps(text(form, 'agentCommission')),
      vatBps: percentToBps(text(form, 'vat')),
    };
    const bad = Object.entries(rates).find(([, v]) => v === null);
    if (bad) {
      setError({
        success: false,
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Enter percentages like 10 or 7.5',
        details: { issues: [{ path: bad[0], message: 'Enter a percentage like 10 or 7.5' }] },
      });
      return;
    }
    const input = validate(pricingConfigSchema, {
      ...rates,
      vatOnServiceFee: form.get('vatOnServiceFee') === 'on',
      vatOnStay: form.get('vatOnStay') === 'on',
      note: text(form, 'note').trim() || undefined,
    });
    if (!input) return;
    const done = await run(() => api('POST', '/admin/finance/pricing', input));
    if (done) {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {error && error.code !== ErrorCode.VALIDATION_ERROR && (
        <Alert tone="error">{error.message}</Alert>
      )}
      {saved && <Alert tone="success">Saved. New bookings use these rates.</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Service fee (%)"
          hint="Paid by the customer"
          error={fieldErrors.serviceFeeBps}
        >
          {(a) => (
            <Input
              {...a}
              name="serviceFee"
              inputMode="decimal"
              defaultValue={pct(current?.serviceFeeBps)}
              required
            />
          )}
        </Field>
        <Field
          label="Agent commission (%)"
          hint="Deducted from the agent"
          error={fieldErrors.agentCommissionBps}
        >
          {(a) => (
            <Input
              {...a}
              name="agentCommission"
              inputMode="decimal"
              defaultValue={pct(current?.agentCommissionBps)}
              required
            />
          )}
        </Field>
        <Field label="VAT (%)" error={fieldErrors.vatBps}>
          {(a) => (
            <Input
              {...a}
              name="vat"
              inputMode="decimal"
              defaultValue={pct(current?.vatBps)}
              required
            />
          )}
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2 text-sm text-text">
        <legend className="mb-1 font-medium">Charge VAT on</legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="vatOnServiceFee"
            defaultChecked={current?.vatOnServiceFee ?? true}
            className="size-4 accent-primary"
          />
          HavenHub’s service fee
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="vatOnStay"
            defaultChecked={current?.vatOnStay ?? false}
            className="size-4 accent-primary"
          />
          The stay and cleaning (e.g. commercial lets)
        </label>
      </fieldset>
      <Field label="Note" optional hint="Why the rates changed — kept in the history.">
        {(a) => <Input {...a} name="note" maxLength={500} />}
      </Field>
      <div>
        <Button type="submit" loading={pending}>
          Save new rates
        </Button>
      </div>
    </form>
  );
}
