'use client';

import {
  MODERATED_LISTING_LABELS,
  MODERATED_LISTING_TYPES,
  updateMaintenanceSchema,
  updateModerationPolicySchema,
  type PlatformSettingsView,
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
  Textarea,
} from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { api } from '@/lib/api/client';
import { formText } from '@/lib/form';
import { useApiAction } from '@/lib/use-api-action';

export function MaintenanceForm({ settings }: { settings: PlatformSettingsView }) {
  const router = useRouter();
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [saved, setSaved] = useState(false);
  const m = settings.maintenance;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const f = new FormData(event.currentTarget);
    const enabled = f.get('enabled') === 'on';
    if (enabled && !m.enabled && !window.confirm('Take the public site offline now?')) return;
    const input = validate(updateMaintenanceSchema, {
      enabled,
      message: formText(f, 'message'),
      returnText: formText(f, 'returnText'),
    });
    if (!input) return;
    if (await run(() => api('PATCH', '/admin/settings/maintenance', input))) {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Status"
          action={
            m.enabled ? (
              <Badge tone="warning">Site offline</Badge>
            ) : (
              <Badge tone="success">Site online</Badge>
            )
          }
        />
        <CardBody className="flex flex-col gap-5">
          <label className="flex items-start gap-3 text-sm text-text">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={m.enabled}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              Maintenance mode
              <span className="block text-text-muted">
                Visitors, customers and agents see the maintenance page (HTTP 503). Administrators,
                sign-in, payment webhooks and background jobs keep working.
              </span>
            </span>
          </label>
          <Field label="Message" optional error={fieldErrors.message}>
            {(a) => (
              <Textarea
                {...a}
                name="message"
                rows={3}
                defaultValue={m.message ?? ''}
                maxLength={500}
              />
            )}
          </Field>
          <Field
            label="Estimated return"
            optional
            hint='Shown as written, e.g. "Back by 3pm WAT".'
            error={fieldErrors.returnText}
          >
            {(a) => (
              <Input {...a} name="returnText" defaultValue={m.returnText ?? ''} maxLength={200} />
            )}
          </Field>
          <p className="text-xs text-text-muted">
            The page uses the site name, logo and contact details from Site settings.
          </p>
        </CardBody>
      </Card>
      {error && error.code !== 'VALIDATION_ERROR' && <Alert tone="error">{error.message}</Alert>}
      {saved && <Alert tone="success">Saved.</Alert>}
      <div>
        <Button type="submit" loading={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}

export function ModerationForm({ settings }: { settings: PlatformSettingsView }) {
  const router = useRouter();
  const { pending, error, validate, run } = useApiAction();
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const f = new FormData(event.currentTarget);
    const input = validate(
      updateModerationPolicySchema,
      Object.fromEntries(MODERATED_LISTING_TYPES.map((t) => [t, f.get(t) === 'on'])),
    );
    if (!input) return;
    if (await run(() => api('PATCH', '/admin/settings/moderation', input))) {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Require admin review before publishing"
          description="Applies to the next submission or edit. Listings already published or waiting for review keep their state. Only verified agents can submit."
        />
        <CardBody className="flex flex-col gap-4">
          {MODERATED_LISTING_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-3 text-sm text-text">
              <input
                type="checkbox"
                name={type}
                defaultChecked={settings.moderation[type]}
                className="size-4 accent-primary"
              />
              {MODERATED_LISTING_LABELS[type]}
            </label>
          ))}
        </CardBody>
      </Card>
      {error && <Alert tone="error">{error.message}</Alert>}
      {saved && <Alert tone="success">Moderation policy saved.</Alert>}
      <div>
        <Button type="submit" loading={pending}>
          Save policy
        </Button>
      </div>
    </form>
  );
}
