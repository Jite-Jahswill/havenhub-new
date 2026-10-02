'use client';

import type { ConversationStatus } from '@havenhub/shared';
import { Alert, Button, Field, Input } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';
import { useApiAction } from '@/lib/use-api-action';

export function RemoveMessage({ messageId }: { messageId: string }) {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useApiAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="mt-2" onClick={() => setOpen(true)}>
        Remove message
      </Button>
    );
  }
  return (
    <div className="mt-3 flex flex-col gap-2">
      {error && error.code !== 'VALIDATION_ERROR' && <Alert tone="error">{error.message}</Alert>}
      <Field label="Reason for removal" error={fieldErrors.reason}>
        {(a) => (
          <Input
            {...a}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
        )}
      </Field>
      <div className="flex gap-2">
        <Button
          variant="danger"
          size="sm"
          loading={pending}
          onClick={async () => {
            const done = await run(() =>
              api('POST', `/admin/messages/${messageId}/remove`, { reason }),
            );
            if (done) router.refresh();
          }}
        >
          Remove for everyone
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function ConversationModeration({
  conversationId,
  status,
}: {
  conversationId: string;
  status: ConversationStatus;
}) {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useApiAction();
  const [reason, setReason] = useState('');
  const target = status === 'OPEN' ? 'CLOSED' : 'OPEN';
  return (
    <div className="flex flex-col gap-3">
      {error && error.code !== 'VALIDATION_ERROR' && <Alert tone="error">{error.message}</Alert>}
      <p className="text-sm text-text-secondary">
        {status === 'OPEN'
          ? 'Closing stops new messages; both participants can still read the history.'
          : 'Reopening lets both participants send messages again.'}
      </p>
      <Field label="Reason" error={fieldErrors.reason}>
        {(a) => (
          <Input
            {...a}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
        )}
      </Field>
      <Button
        variant={target === 'CLOSED' ? 'danger' : 'primary'}
        loading={pending}
        onClick={async () => {
          const done = await run(() =>
            api('POST', `/admin/conversations/${conversationId}/status`, {
              status: target,
              reason,
            }),
          );
          if (done) {
            setReason('');
            router.refresh();
          }
        }}
      >
        {target === 'CLOSED' ? 'Close conversation' : 'Reopen conversation'}
      </Button>
    </div>
  );
}
