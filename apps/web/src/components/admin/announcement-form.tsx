'use client';

import {
  NOTIFICATION_AUDIENCE_LABELS,
  NotificationAudience,
  sendBroadcastSchema,
  type NotificationBroadcastView,
} from '@havenhub/shared';
import { Alert, Button, Card, CardBody, Field, Input, Select, Textarea } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { api } from '@/lib/api/client';
import { formText } from '@/lib/form';
import { useApiAction } from '@/lib/use-api-action';

/** Compose an in-app announcement; it lands in each recipient's notifications. */
export function AnnouncementForm() {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const { pending, error, fieldErrors, validate, run } = useApiAction();
  const [audience, setAudience] = useState<NotificationAudience>('ALL');
  const [sent, setSent] = useState<NotificationBroadcastView | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSent(null);
    const f = new FormData(event.currentTarget);
    const input = validate(sendBroadcastSchema, {
      audience,
      email: audience === 'USER' ? formText(f, 'email') : undefined,
      title: formText(f, 'title'),
      body: formText(f, 'body'),
      link: formText(f, 'link'),
    });
    if (!input) return;
    const label = NOTIFICATION_AUDIENCE_LABELS[audience].toLowerCase();
    if (audience !== 'USER' && !window.confirm(`Send this to ${label}? It cannot be unsent.`)) {
      return;
    }
    const result = await run(() =>
      api<NotificationBroadcastView>('POST', '/admin/notifications/broadcasts', input),
    );
    if (result) {
      setSent(result);
      form.current?.reset();
      setAudience('ALL');
      router.refresh();
    }
  }

  return (
    <form ref={form} method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Card>
        <CardBody className="flex flex-col gap-5">
          <Field label="Send to" error={fieldErrors.audience}>
            {(a) => (
              <Select
                {...a}
                name="audience"
                value={audience}
                onChange={(e) => setAudience(e.target.value as NotificationAudience)}
              >
                {Object.values(NotificationAudience).map((value) => (
                  <option key={value} value={value}>
                    {NOTIFICATION_AUDIENCE_LABELS[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {audience === 'USER' && (
            <Field label="Email address" error={fieldErrors.email}>
              {(a) => <Input {...a} name="email" type="email" autoComplete="off" />}
            </Field>
          )}
          <Field label="Title" error={fieldErrors.title}>
            {(a) => <Input {...a} name="title" maxLength={160} />}
          </Field>
          <Field label="Message" error={fieldErrors.body}>
            {(a) => <Textarea {...a} name="body" rows={4} maxLength={1000} />}
          </Field>
          <Field
            label="Link"
            optional
            hint="A page on HavenHub people open from the notification, e.g. /properties or /agent/subscription/plans."
            error={fieldErrors.link}
          >
            {(a) => <Input {...a} name="link" placeholder="/properties" maxLength={500} />}
          </Field>
          <p className="text-xs text-text-muted">
            Only active customers and agents receive announcements. Each one is recorded in the
            audit log.
          </p>
        </CardBody>
      </Card>
      {error && error.code !== 'VALIDATION_ERROR' && <Alert tone="error">{error.message}</Alert>}
      {sent && (
        <Alert tone="success">
          Sent to {sent.recipientCount} {sent.recipientCount === 1 ? 'person' : 'people'}.
        </Alert>
      )}
      <div>
        <Button type="submit" loading={pending}>
          Send announcement
        </Button>
      </div>
    </form>
  );
}
