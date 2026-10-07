'use client';

import { ErrorCode, changePasswordSchema, type SessionView } from '@havenhub/shared';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field } from '@havenhub/ui';
import { Monitor, Smartphone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { PasswordInput } from '@/components/auth/password-input';
import { ThemeToggle } from '@/components/theme-toggle';
import { api } from '@/lib/api/client';
import { useApiAction } from '@/lib/use-api-action';

export function SecuritySettings({
  sessions,
  passwordMinLength,
}: {
  sessions: SessionView[];
  /** From the admin security policy; the API enforces it. */
  passwordMinLength: number;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Password"
          description="Changing your password signs you out of every other device."
        />
        <CardBody>
          <ChangePasswordForm passwordMinLength={passwordMinLength} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Where you’re signed in"
          description="Sign out of devices you don’t recognise."
        />
        <CardBody>
          <SessionsList sessions={sessions} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Appearance" description="Choose light, dark, or follow your device." />
        <CardBody>
          <ThemeToggle />
        </CardBody>
      </Card>
    </div>
  );
}

function ChangePasswordForm({ passwordMinLength }: { passwordMinLength: number }) {
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDone(false);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const input = validate(changePasswordSchema, {
      currentPassword: form.get('currentPassword'),
      newPassword: form.get('newPassword'),
    });
    if (!input) return;
    if (await run(() => api('POST', '/auth/change-password', input))) {
      setDone(true);
      formElement.reset();
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-md flex-col gap-5">
      {done && <Alert tone="success">Password changed. Other devices have been signed out.</Alert>}
      {error && error.code !== ErrorCode.VALIDATION_ERROR && (
        <Alert tone="error">{error.message}</Alert>
      )}
      <Field label="Current password" error={fieldErrors.currentPassword}>
        {(a) => <PasswordInput {...a} name="currentPassword" autoComplete="current-password" />}
      </Field>
      <Field
        label="New password"
        error={fieldErrors.newPassword}
        hint={`At least ${passwordMinLength} characters`}
      >
        {(a) => <PasswordInput {...a} name="newPassword" autoComplete="new-password" />}
      </Field>
      <div>
        <Button type="submit" loading={pending}>
          Change password
        </Button>
      </div>
    </form>
  );
}

function describeDevice(userAgent: string | null): { label: string; mobile: boolean } {
  if (!userAgent) return { label: 'Unknown device', mobile: false };
  const mobile = /mobile|android|iphone|ipad|dart/i.test(userAgent);
  const browser = /dart/i.test(userAgent)
    ? 'HavenHub app'
    : /edg\//i.test(userAgent)
      ? 'Edge'
      : /chrome\//i.test(userAgent)
        ? 'Chrome'
        : /firefox\//i.test(userAgent)
          ? 'Firefox'
          : /safari\//i.test(userAgent)
            ? 'Safari'
            : 'Browser';
  const os = /iphone|ipad/i.test(userAgent)
    ? 'iOS'
    : /android/i.test(userAgent)
      ? 'Android'
      : /mac os/i.test(userAgent)
        ? 'macOS'
        : /windows/i.test(userAgent)
          ? 'Windows'
          : /linux/i.test(userAgent)
            ? 'Linux'
            : '';
  return { label: os ? `${browser} on ${os}` : browser, mobile };
}

function SessionsList({ sessions }: { sessions: SessionView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function revoke(id: string) {
    setBusy(id);
    await api('DELETE', `/auth/sessions/${id}`);
    setBusy(null);
    router.refresh();
  }

  async function signOutEverywhere() {
    setBusy('all');
    await api('POST', '/auth/logout-all');
    router.replace('/login');
    router.refresh();
  }

  const formatter = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="flex flex-col gap-6">
      <ul className="divide-y divide-border">
        {sessions.map((session) => {
          const device = describeDevice(session.userAgent);
          const Icon = device.mobile ? Smartphone : Monitor;
          return (
            <li key={session.id} className="flex items-center gap-4 py-4 first:pt-0">
              <Icon aria-hidden className="size-5 shrink-0 text-text-muted" strokeWidth={1.6} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium text-text">
                  {device.label}
                  {session.current && <Badge tone="success">This device</Badge>}
                </p>
                <p className="text-xs text-text-muted">
                  Last active {formatter.format(new Date(session.lastUsedAt))}
                  {session.ipAddress ? ` · ${session.ipAddress}` : ''}
                </p>
              </div>
              {!session.current && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => revoke(session.id)}
                  loading={busy === session.id}
                >
                  Sign out
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <div>
        <Button variant="danger" size="sm" onClick={signOutEverywhere} loading={busy === 'all'}>
          Sign out of all devices
        </Button>
      </div>
    </div>
  );
}
