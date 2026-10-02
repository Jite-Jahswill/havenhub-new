'use client';

import { ErrorCode, loginSchema, type AuthUser } from '@havenhub/shared';
import { Alert, Button, Field, Input } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { api } from '@/lib/api/client';
import { DASHBOARD_PATH, safeNextPath } from '@/lib/navigation';
import { useApiAction } from '@/lib/use-api-action';

import { PasswordInput } from './password-input';
import { ResendVerification } from './resend-verification';

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [email, setEmail] = useState('');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = validate(loginSchema, {
      email: form.get('email'),
      password: form.get('password'),
    });
    if (!input) return;
    setEmail(input.email);
    const result = await run(() => api<{ user: AuthUser }>('POST', '/auth/login', input));
    if (result) {
      router.replace(safeNextPath(next) ?? DASHBOARD_PATH[result.user.accountType]);
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {error && error.code !== ErrorCode.VALIDATION_ERROR && (
        <Alert tone={error.code === ErrorCode.EMAIL_NOT_VERIFIED ? 'warning' : 'error'}>
          {error.message}
          {error.code === ErrorCode.EMAIL_NOT_VERIFIED && <ResendVerification email={email} />}
        </Alert>
      )}
      <Field label="Email address" error={fieldErrors.email}>
        {(a) => <Input {...a} name="email" type="email" autoComplete="email" required />}
      </Field>
      <Field label="Password" error={fieldErrors.password}>
        {(a) => <PasswordInput {...a} name="password" autoComplete="current-password" required />}
      </Field>
      <div className="-mt-2 text-right">
        <a
          href="/forgot-password"
          className="text-sm font-medium text-primary-text hover:underline"
        >
          Forgot your password?
        </a>
      </div>
      <Button type="submit" size="lg" loading={pending}>
        Sign in
      </Button>
    </form>
  );
}
