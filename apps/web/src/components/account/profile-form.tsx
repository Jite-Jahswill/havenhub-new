'use client';

import { ErrorCode, updateMyProfileSchema, type AuthUser } from '@havenhub/shared';
import { Alert, Badge, Button, Field, Input } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { api } from '@/lib/api/client';
import { formText } from '@/lib/form';
import { useApiAction } from '@/lib/use-api-action';

import { AvatarUploader } from './avatar-uploader';

/** Shows a Nigerian E.164 number in its familiar local form. */
const localPhone = (phone: string | null) => (phone ? `0${phone.slice(4)}` : '');

export function ProfileForm({ user }: { user: AuthUser }) {
  const router = useRouter();
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const phone = formText(form, 'phone');
    const input = validate(updateMyProfileSchema, {
      fullName: form.get('fullName'),
      phone: phone || null,
    });
    if (!input) return;
    if (await run(() => api<AuthUser>('PATCH', '/users/me', input))) {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-xl flex-col gap-5">
      <AvatarUploader user={user} />
      {saved && <Alert tone="success">Your profile has been updated.</Alert>}
      {error && error.code !== ErrorCode.VALIDATION_ERROR && (
        <Alert tone="error">{error.message}</Alert>
      )}
      <Field label="Full name" error={fieldErrors.fullName}>
        {(a) => <Input {...a} name="fullName" defaultValue={user.fullName} autoComplete="name" />}
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-text">Email address</span>
        <div className="flex items-center gap-3">
          <span className="text-text">{user.email}</span>
          <Badge tone={user.emailVerified ? 'success' : 'warning'}>
            {user.emailVerified ? 'Verified' : 'Not verified'}
          </Badge>
        </div>
      </div>
      <Field label="Phone number" optional error={fieldErrors.phone}>
        {(a) => (
          <Input
            {...a}
            name="phone"
            type="tel"
            defaultValue={localPhone(user.phone)}
            autoComplete="tel"
          />
        )}
      </Field>
      <div>
        <Button type="submit" loading={pending}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
