'use client';

import type { AdminSubscriptionDetail } from '@havenhub/shared';
import { Alert, Button, Field, Textarea } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';
import { useApiAction } from '@/lib/use-api-action';

type Action = 'CANCEL' | 'SUSPEND' | 'REACTIVATE';

const COPY: Record<Action, { label: string; explain: string }> = {
  SUSPEND: {
    label: 'Suspend',
    explain:
      'The agent falls back to the free plan while suspended. The paid period keeps running.',
  },
  REACTIVATE: {
    label: 'Reactivate',
    explain: 'Restores the plan for the rest of its paid period.',
  },
  CANCEL: {
    label: 'Cancel',
    explain:
      'Ends the subscription now. No refund is made automatically; nothing the agent owns is deleted.',
  },
};

export function SubscriptionAdminActions({
  subscription,
}: {
  subscription: AdminSubscriptionDetail;
}) {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useApiAction();
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');

  const available: Action[] =
    subscription.status === 'ACTIVE'
      ? ['SUSPEND', 'CANCEL']
      : subscription.status === 'SUSPENDED'
        ? ['REACTIVATE', 'CANCEL']
        : subscription.status === 'PENDING'
          ? ['CANCEL']
          : [];
  if (available.length === 0) {
    return <p className="text-sm text-text-secondary">This subscription has ended.</p>;
  }

  async function submit() {
    if (!action) return;
    const done = await run(() =>
      api('POST', `/admin/subscriptions/${subscription.id}/actions`, { action, reason }),
    );
    if (done) {
      setAction(null);
      setReason('');
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && error.code !== 'VALIDATION_ERROR' && <Alert tone="error">{error.message}</Alert>}
      {!action ? (
        <div className="flex flex-wrap gap-3">
          {available.map((a) => (
            <Button
              key={a}
              variant={a === 'CANCEL' ? 'danger' : 'secondary'}
              onClick={() => setAction(a)}
            >
              {COPY[a].label}
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-secondary">{COPY[action].explain}</p>
          <Field
            label="Reason"
            hint="Recorded in the audit log and sent to the agent."
            error={fieldErrors.reason}
          >
            {(a) => (
              <Textarea
                {...a}
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button
              variant={action === 'CANCEL' ? 'danger' : 'primary'}
              onClick={submit}
              loading={pending}
            >
              Confirm {COPY[action].label.toLowerCase()}
            </Button>
            <Button variant="ghost" onClick={() => setAction(null)} disabled={pending}>
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
