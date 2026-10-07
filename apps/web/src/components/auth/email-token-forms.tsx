'use client';

import { ErrorCode, emailOnlySchema, resetPasswordSchema } from '@havenhub/shared';
import { Alert, Button, Field, Input, Spinner, buttonClasses } from '@havenhub/ui';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { api } from '@/lib/api/client';
import { useApiAction } from '@/lib/use-api-action';

import { PasswordInput } from './password-input';

export function VerifyEmail({ token }: { token: string | undefined }) {
  const [state, setState] = useState<'verifying' | 'verified' | 'invalid'>(
    token ? 'verifying' : 'invalid',
  );
  const started = useRef(false);

  useEffect(() => {
    // Tokens are single-use: guard against React running effects twice in development.
    if (!token || started.current) return;
    started.current = true;
    void api('POST', '/auth/verify-email', { token }).then((res) =>
      setState(res.success ? 'verified' : 'invalid'),
    );
  }, [token]);

  if (state === 'verifying') {
    return (
      <p className="flex items-center gap-3 text-text-secondary" role="status">
        <Spinner /> Verifying your email…
      </p>
    );
  }
  if (state === 'verified') {
    return (
      <div className="flex flex-col gap-6">
        <Alert tone="success">Your email is verified. You can now sign in.</Alert>
        <Link href="/login" className={buttonClasses({ size: 'lg' })}>
          Continue to sign in
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <Alert tone="error">This verification link is invalid or has expired.</Alert>
      <RequestEmailForm
        endpoint="/auth/resend-verification"
        submitLabel="Send a new link"
        doneMessage="If your account still needs verifying, a new link is on its way."
      />
    </div>
  );
}

export function RequestEmailForm({
  endpoint,
  submitLabel,
  doneMessage,
  defaultEmail,
}: {
  endpoint: '/auth/forgot-password' | '/auth/resend-verification';
  submitLabel: string;
  doneMessage: string;
  defaultEmail?: string;
}) {
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = validate(emailOnlySchema, {
      email: new FormData(event.currentTarget).get('email'),
    });
    if (!input) return;
    if (await run(() => api('POST', endpoint, input))) setDone(true);
  }

  if (done) return <Alert tone="success">{doneMessage}</Alert>;
  return (
    // method="post": a native submission (before JavaScript loads) keeps the
    // email address in the request body — never in the URL or logs.
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {error && error.code !== ErrorCode.VALIDATION_ERROR && (
        <Alert tone="error">{error.message}</Alert>
      )}
      <Field label="Email address" error={fieldErrors.email}>
        {(a) => (
          <Input
            {...a}
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={defaultEmail}
            required
          />
        )}
      </Field>
      <Button type="submit" size="lg" loading={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({
  token,
  passwordMinLength,
}: {
  token: string | undefined;
  /** From the admin security policy; the API enforces it. */
  passwordMinLength: number;
}) {
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = validate(resetPasswordSchema, {
      token,
      password: new FormData(event.currentTarget).get('password'),
    });
    if (!input) return;
    if (await run(() => api('POST', '/auth/reset-password', input))) setDone(true);
  }

  if (!token)
    return <Alert tone="error">This reset link is incomplete. Please request a new one.</Alert>;
  if (done) {
    return (
      <div className="flex flex-col gap-6">
        <Alert tone="success">
          Your password has been changed and you have been signed out everywhere.
        </Alert>
        <Link href="/login" className={buttonClasses({ size: 'lg' })}>
          Sign in
        </Link>
      </div>
    );
  }
  const tokenProblem = error && (error.code === ErrorCode.INVALID_TOKEN || fieldErrors.token);
  return (
    // method="post": a native submission (before JavaScript loads) keeps the
    // password in the request body — never in the URL or logs.
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {tokenProblem && (
        <Alert tone="error">
          This reset link is invalid or has expired.{' '}
          <Link href="/forgot-password" className="font-semibold underline">
            Request a new one
          </Link>
          .
        </Alert>
      )}
      {error && !tokenProblem && error.code !== ErrorCode.VALIDATION_ERROR && (
        <Alert tone="error">{error.message}</Alert>
      )}
      <Field
        label="New password"
        error={fieldErrors.password}
        hint={`At least ${passwordMinLength} characters`}
      >
        {(a) => <PasswordInput {...a} name="password" autoComplete="new-password" required />}
      </Field>
      <Button type="submit" size="lg" loading={pending}>
        Set new password
      </Button>
    </form>
  );
}
