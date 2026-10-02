'use client';

import { ErrorCode, type AdminPropertyDetail, type ModerationAction } from '@havenhub/shared';
import { Alert, Button, Field, Textarea } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';
import { useApiAction } from '@/lib/use-api-action';

/** Mirrors the API's moderation rules for display; the API re-validates every action. */
const ACTIONS: Partial<
  Record<
    AdminPropertyDetail['status'],
    { action: ModerationAction; label: string; variant: 'primary' | 'secondary' | 'danger' }[]
  >
> = {
  PENDING_REVIEW: [
    { action: 'APPROVE', label: 'Approve & publish', variant: 'primary' },
    { action: 'REJECT', label: 'Request changes', variant: 'danger' },
    { action: 'SUSPEND', label: 'Suspend', variant: 'secondary' },
  ],
  PUBLISHED: [{ action: 'SUSPEND', label: 'Suspend listing', variant: 'danger' }],
  SUSPENDED: [{ action: 'RESTORE', label: 'Restore', variant: 'primary' }],
};

/** Also moderates events, tours, hotels and cleaning services (same rules, own endpoint). */
export function PropertyModeration({
  property,
  endpoint = `/admin/properties/${property.id}/moderation`,
}: {
  property: Pick<AdminPropertyDetail, 'id' | 'status'>;
  endpoint?: string;
}) {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useApiAction();
  const [note, setNote] = useState('');
  const [target, setTarget] = useState<ModerationAction | null>(null);
  const actions = ACTIONS[property.status] ?? [];

  async function apply(action: ModerationAction) {
    setTarget(action);
    const done = await run(() =>
      api('PATCH', endpoint, {
        action,
        note: note.trim() || undefined,
      }),
    );
    if (done) {
      setNote('');
      router.refresh();
    }
  }

  if (!actions.length) {
    return (
      <p className="text-sm text-text-secondary">
        No moderation actions are available for this status.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {error && error.code !== ErrorCode.VALIDATION_ERROR && (
        <Alert tone="error">{error.message}</Alert>
      )}
      <Field
        label="Note to the agent"
        optional
        hint="Required when requesting changes or suspending."
        error={fieldErrors.note}
      >
        {(a) => (
          <Textarea
            {...a}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-3">
        {actions.map(({ action, label, variant }) => (
          <Button
            key={action}
            variant={variant}
            onClick={() => apply(action)}
            loading={pending && target === action}
            disabled={pending}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
