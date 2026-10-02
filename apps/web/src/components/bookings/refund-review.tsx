'use client';

import { ErrorCode, type RefundStatus } from '@havenhub/shared';
import { Alert, Button, Field, Textarea } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';
import { useApiAction } from '@/lib/use-api-action';

/** Approve (sends the money back through the provider) or reject a refund. */
export function RefundReview({ refundId, status }: { refundId: string; status: RefundStatus }) {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useApiAction();
  const [note, setNote] = useState('');
  const [action, setAction] = useState<'APPROVE' | 'REJECT' | null>(null);

  async function review(next: 'APPROVE' | 'REJECT') {
    setAction(next);
    const done = await run(() =>
      api('POST', `/admin/refunds/${refundId}/review`, {
        action: next,
        note: note.trim() || undefined,
      }),
    );
    if (done) {
      setNote('');
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && error.code !== ErrorCode.VALIDATION_ERROR && (
        <Alert tone="error">{error.message}</Alert>
      )}
      <Field label="Note" optional hint="Required when rejecting." error={fieldErrors.note}>
        {(a) => (
          <Textarea {...a} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => review('APPROVE')}
          loading={pending && action === 'APPROVE'}
          disabled={pending}
        >
          {status === 'FAILED' ? 'Retry refund' : 'Approve & refund'}
        </Button>
        {status === 'REQUESTED' && (
          <Button
            size="sm"
            variant="danger"
            onClick={() => review('REJECT')}
            loading={pending && action === 'REJECT'}
            disabled={pending}
          >
            Reject
          </Button>
        )}
      </div>
    </div>
  );
}
