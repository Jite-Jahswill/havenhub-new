'use client';

import {
  ErrorCode,
  PASSWORD_MIN_LENGTH,
  Sex,
  registerAgentSchema,
  registerCustomerSchema,
} from '@havenhub/shared';
import { Alert, Button, Field, Input, Select, cn } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';

import { api } from '@/lib/api/client';
import { CHECK_EMAIL_PATH, rememberPendingEmail } from '@/lib/check-email';
import { SERVICE_LABELS } from '@/lib/labels';
import { formText } from '@/lib/form';
import { useApiAction } from '@/lib/use-api-action';

import { PasswordInput } from './password-input';

/** Public registration. The account type is fixed by the endpoint, never by the form. */
export function RegisterForm({ variant }: { variant: 'customer' | 'agent' }) {
  const router = useRouter();
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const isAgent = variant === 'agent';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const phone = formText(form, 'phone');
    const base = {
      fullName: form.get('fullName'),
      email: form.get('email'),
      password: form.get('password'),
    };

    const input = isAgent
      ? validate(registerAgentSchema, {
          ...base,
          phone,
          sex: form.get('sex') || undefined,
          serviceTypes: form.getAll('serviceTypes'),
          businessName: formText(form, 'businessName') || undefined,
        })
      : validate(registerCustomerSchema, { ...base, phone: phone || undefined });
    if (!input) return;

    const done = await run(() => api('POST', `/auth/register/${variant}`, input));
    if (done) {
      // The address is shown on the next page via sessionStorage, never the URL.
      rememberPendingEmail(input.email);
      router.push(CHECK_EMAIL_PATH);
    }
  }

  return (
    // method="post": a native submission (before JavaScript loads) keeps the
    // password in the request body — never in the URL or logs.
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {error && error.code !== ErrorCode.VALIDATION_ERROR && (
        <Alert tone="error">{error.message}</Alert>
      )}
      <Field label="Full name" error={fieldErrors.fullName}>
        {(a) => <Input {...a} name="fullName" autoComplete="name" required />}
      </Field>
      <Field label="Email address" error={fieldErrors.email}>
        {(a) => <Input {...a} name="email" type="email" autoComplete="email" required />}
      </Field>
      <Field
        label="Phone number"
        error={fieldErrors.phone}
        optional={!isAgent}
        hint="e.g. 0803 123 4567"
      >
        {(a) => <Input {...a} name="phone" type="tel" autoComplete="tel" inputMode="tel" />}
      </Field>

      {isAgent && (
        <>
          <Field label="Business name" optional error={fieldErrors.businessName}>
            {(a) => <Input {...a} name="businessName" autoComplete="organization" />}
          </Field>
          <Field label="Sex" error={fieldErrors.sex}>
            {(a) => (
              <Select {...a} name="sex" defaultValue="">
                <option value="" disabled>
                  Select
                </option>
                <option value={Sex.FEMALE}>Female</option>
                <option value={Sex.MALE}>Male</option>
              </Select>
            )}
          </Field>
          <fieldset>
            <legend className="text-sm font-medium text-text">What do you offer?</legend>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {Object.entries(SERVICE_LABELS).map(([value, label]) => (
                <label
                  key={value}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-control border border-border px-3.5 py-2.5 text-sm',
                    'has-checked:border-primary has-checked:bg-primary-subtle',
                  )}
                >
                  <input
                    type="checkbox"
                    name="serviceTypes"
                    value={value}
                    className="size-4 accent-primary"
                  />
                  {label}
                </label>
              ))}
            </div>
            {fieldErrors.serviceTypes && (
              <p className="mt-1.5 text-xs font-medium text-error" role="alert">
                {fieldErrors.serviceTypes}
              </p>
            )}
          </fieldset>
        </>
      )}

      <Field
        label="Password"
        error={fieldErrors.password}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
      >
        {(a) => <PasswordInput {...a} name="password" autoComplete="new-password" required />}
      </Field>
      <Button type="submit" size="lg" loading={pending}>
        {isAgent ? 'Create agent account' : 'Create account'}
      </Button>
      <p className="text-center text-xs text-text-muted">
        By continuing you agree to HavenHub’s terms and privacy policy.
      </p>
    </form>
  );
}
