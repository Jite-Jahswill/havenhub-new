'use client';

import {
  SMTP_PORTS,
  updateSmtpSettingsSchema,
  type SmtpSettingsView,
  type SmtpTestResult,
} from '@havenhub/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
} from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { api } from '@/lib/api/client';
import { formText } from '@/lib/form';
import { useApiAction } from '@/lib/use-api-action';

const SOURCE_LABEL: Record<SmtpSettingsView['source'], string> = {
  DATABASE: 'Using these settings',
  ENVIRONMENT: 'Using the server configuration',
  NONE: 'Not configured',
};

/**
 * Admin-managed SMTP. The password field is write-only: it is never
 * pre-filled or kept in page state, and leaving it empty keeps the stored one.
 */
export function SmtpForm({ settings, email }: { settings: SmtpSettingsView; email: string }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const save = useApiAction();
  const test = useApiAction();
  const remove = useApiAction();
  const [saved, setSaved] = useState(false);
  const [result, setResult] = useState<SmtpTestResult | null>(null);
  const db = settings.database;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const f = new FormData(event.currentTarget);
    const password = typeof f.get('password') === 'string' ? (f.get('password') as string) : '';
    const clearPassword = f.get('clearPassword') === 'on';
    const input = save.validate(updateSmtpSettingsSchema, {
      host: formText(f, 'host'),
      port: Number(formText(f, 'port')),
      security: formText(f, 'security'),
      username: formText(f, 'username'),
      ...(clearPassword ? { password: null } : password ? { password } : {}),
      fromEmail: formText(f, 'fromEmail'),
      fromName: formText(f, 'fromName'),
    });
    if (!input) return;
    const ok = await save.run(() => api('PUT', '/admin/settings/smtp', input));
    // Never keep the typed password around.
    const field = form.current?.elements.namedItem('password');
    if (field instanceof HTMLInputElement) field.value = '';
    if (ok) {
      setSaved(true);
      router.refresh();
    }
  }

  async function sendTest() {
    setResult(null);
    const res = await test.run(() => api<SmtpTestResult>('POST', '/admin/settings/smtp/test'));
    if (res) setResult(res);
  }

  async function removeSettings() {
    if (
      !window.confirm(
        'Remove these SMTP settings? Email will use the server configuration, if there is one.',
      )
    )
      return;
    if (await remove.run(() => api('DELETE', '/admin/settings/smtp'))) router.refresh();
  }

  const err = (k: string) => save.fieldErrors[k];
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <Badge tone={settings.source === 'NONE' ? 'warning' : 'success'}>
            {SOURCE_LABEL[settings.source]}
          </Badge>
          {settings.source === 'ENVIRONMENT' && settings.environment && (
            <span className="text-sm text-text-secondary">
              Server host: <span className="font-mono">{settings.environment.host}</span>. Saving
              settings here overrides it.
            </span>
          )}
        </CardBody>
      </Card>

      <form
        ref={form}
        method="post"
        onSubmit={onSubmit}
        noValidate
        autoComplete="off"
        className="flex flex-col gap-6"
      >
        <Card>
          <CardHeader title="Server" />
          <CardBody className="grid gap-5 sm:grid-cols-2">
            <Field
              label="SMTP host"
              error={err('host')}
              hint="Private and local addresses are not allowed."
            >
              {(a) => (
                <Input
                  {...a}
                  name="host"
                  defaultValue={db?.host ?? ''}
                  placeholder="smtp.example.com"
                />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Port" error={err('port')}>
                {(a) => (
                  <Select {...a} name="port" defaultValue={String(db?.port ?? 587)}>
                    {SMTP_PORTS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Encryption" error={err('security')}>
                {(a) => (
                  <Select {...a} name="security" defaultValue={db?.security ?? 'STARTTLS'}>
                    <option value="STARTTLS">STARTTLS</option>
                    <option value="TLS">TLS</option>
                  </Select>
                )}
              </Field>
            </div>
            <Field label="Username" optional error={err('username')}>
              {(a) => (
                <Input
                  {...a}
                  name="username"
                  defaultValue={db?.username ?? ''}
                  autoComplete="off"
                />
              )}
            </Field>
            <Field
              label="Password"
              optional
              error={err('password')}
              hint={db?.passwordSet ? 'A password is stored. Leave empty to keep it.' : undefined}
            >
              {(a) => (
                <Input
                  {...a}
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder={db?.passwordSet ? '••••••••  (stored)' : ''}
                />
              )}
            </Field>
            {db?.passwordSet && (
              <label className="flex items-center gap-3 text-sm text-text sm:col-span-2">
                <input type="checkbox" name="clearPassword" className="size-4 accent-primary" />
                Remove the stored password
              </label>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Sender" />
          <CardBody className="grid gap-5 sm:grid-cols-2">
            <Field label="From email" error={err('fromEmail')}>
              {(a) => (
                <Input {...a} name="fromEmail" type="email" defaultValue={db?.fromEmail ?? ''} />
              )}
            </Field>
            <Field label="From name" error={err('fromName')}>
              {(a) => (
                <Input
                  {...a}
                  name="fromName"
                  defaultValue={db?.fromName ?? 'HavenHub'}
                  maxLength={100}
                />
              )}
            </Field>
          </CardBody>
        </Card>
        {save.error && save.error.code !== 'VALIDATION_ERROR' && (
          <Alert tone="error">{save.error.message}</Alert>
        )}
        {saved && <Alert tone="success">SMTP settings saved.</Alert>}
        <div>
          <Button type="submit" loading={save.pending}>
            Save SMTP settings
          </Button>
        </div>
      </form>

      <Card>
        <CardHeader
          title="Send a test email"
          description={`Sent with the active settings to your own address, ${email}.`}
        />
        <CardBody className="flex flex-col gap-4">
          <div>
            <Button
              variant="secondary"
              loading={test.pending}
              disabled={settings.source === 'NONE'}
              onClick={sendTest}
            >
              Send test email
            </Button>
          </div>
          {test.error && <Alert tone="error">{test.error.message}</Alert>}
          {result &&
            (result.delivered ? (
              <Alert tone="success">Test email sent to {result.to}.</Alert>
            ) : (
              <Alert tone="error">Not sent: {result.error}</Alert>
            ))}
        </CardBody>
      </Card>

      {db && (
        <Card>
          <CardHeader
            title="Remove these settings"
            description="Email falls back to the server configuration (if any)."
          />
          <CardBody className="flex flex-col gap-3">
            <div>
              <Button variant="danger" loading={remove.pending} onClick={removeSettings}>
                Remove SMTP settings
              </Button>
            </div>
            {remove.error && <Alert tone="error">{remove.error.message}</Alert>}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
