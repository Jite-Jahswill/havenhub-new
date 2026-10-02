'use client';

import { ErrorCode, type AdminAgentDetail, type AgentVerificationStatus } from '@havenhub/shared';
import { Alert, Button, Field, Textarea } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';
import { useApiAction } from '@/lib/use-api-action';

/** Mirrors the API's transition table for button display only; the API re-validates. */
const ACTIONS: Record<
  AgentVerificationStatus,
  { to: AgentVerificationStatus; label: string; variant: 'primary' | 'secondary' | 'danger' }[]
> = {
  PENDING: [{ to: 'UNDER_REVIEW', label: 'Start review', variant: 'secondary' }],
  UNDER_REVIEW: [
    { to: 'VERIFIED', label: 'Approve', variant: 'primary' },
    { to: 'REJECTED', label: 'Reject', variant: 'danger' },
  ],
  VERIFIED: [
    { to: 'UNDER_REVIEW', label: 'Re-open review', variant: 'secondary' },
    { to: 'SUSPENDED', label: 'Suspend', variant: 'danger' },
  ],
  REJECTED: [{ to: 'UNDER_REVIEW', label: 'Re-open review', variant: 'secondary' }],
  SUSPENDED: [
    { to: 'VERIFIED', label: 'Reinstate', variant: 'primary' },
    { to: 'BLOCKED', label: 'Block', variant: 'danger' },
  ],
  BLOCKED: [{ to: 'UNDER_REVIEW', label: 'Unblock for review', variant: 'secondary' }],
};

export function AgentReview({ agent }: { agent: AdminAgentDetail }) {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useApiAction();
  const [note, setNote] = useState('');
  const [target, setTarget] = useState<AgentVerificationStatus | null>(null);

  async function apply(to: AgentVerificationStatus) {
    setTarget(to);
    const done = await run(() =>
      api('PATCH', `/admin/agents/${agent.id}/verification`, {
        status: to,
        note: note.trim() || undefined,
      }),
    );
    if (done) {
      setNote('');
      router.refresh();
    }
  }

  const actions = ACTIONS[agent.verificationStatus];
  return (
    <div className="flex flex-col gap-5">
      {error && error.code !== ErrorCode.VALIDATION_ERROR && (
        <Alert tone="error">{error.message}</Alert>
      )}
      <Field
        label="Note to the agent"
        optional
        hint="Required when rejecting. The agent will see this."
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
        {actions.map((action) => (
          <Button
            key={action.to}
            variant={action.variant}
            onClick={() => apply(action.to)}
            loading={pending && target === action.to}
            disabled={pending}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
