'use client';

import { newsletterSubscribeSchema } from '@havenhub/shared';
import { Alert, Button, Input } from '@havenhub/ui';
import { useId, useState, type FormEvent } from 'react';

import { api } from '@/lib/api/client';
import { formText } from '@/lib/form';
import { useApiAction } from '@/lib/use-api-action';

/** Shown next to the checkbox when no consent statement has been configured. */
const DEFAULT_CONSENT = 'I agree to receive the HavenHub newsletter by email.';

/** Newsletter signup with an explicit, unticked consent box. */
export function NewsletterForm({ consentText }: { consentText: string | null }) {
  const id = useId();
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [done, setDone] = useState<null | { confirmationRequired: boolean }>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = validate(newsletterSubscribeSchema, {
      email: formText(form, 'email'),
      consent: form.get('consent') === 'on' ? true : false,
      source: 'footer',
    });
    if (!input) return;
    const result = await run(() =>
      api<{ received: true; confirmationRequired: boolean }>(
        'POST',
        '/newsletter/subscribe',
        input,
      ),
    );
    if (result) setDone(result);
  }

  if (done) {
    return (
      <p role="status" className="rounded-control bg-white/10 px-4 py-3">
        {done.confirmationRequired
          ? 'Check your inbox and confirm to start receiving the newsletter.'
          : 'Thanks — you’re subscribed.'}
      </p>
    );
  }
  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <p className="font-semibold">Newsletter</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={`${id}-email`} className="sr-only">
          Email address
        </label>
        <Input
          id={`${id}-email`}
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          aria-invalid={fieldErrors.email ? true : undefined}
          className="min-w-0 flex-1"
        />
        <Button type="submit" loading={pending} variant="secondary">
          Subscribe
        </Button>
      </div>
      {fieldErrors.email && <p className="text-xs font-medium text-error">{fieldErrors.email}</p>}
      <label className="flex items-start gap-2 text-xs opacity-85">
        <input type="checkbox" name="consent" className="mt-0.5 size-4 shrink-0 accent-primary" />
        <span>{consentText ?? DEFAULT_CONSENT}</span>
      </label>
      {fieldErrors.consent && (
        <p className="text-xs font-medium text-error">{fieldErrors.consent}</p>
      )}
      {error && error.code !== 'VALIDATION_ERROR' && <Alert tone="error">{error.message}</Alert>}
    </form>
  );
}
