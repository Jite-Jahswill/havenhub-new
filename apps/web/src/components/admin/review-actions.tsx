'use client';

import { Alert, Button, Input } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';
import { useApiAction } from '@/lib/use-api-action';

/** Hide (with a reason) or restore a review. */
export function ReviewActions({ id, hidden }: { id: string; hidden: boolean }) {
  const router = useRouter();
  const { pending, error, run } = useApiAction();
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);

  async function act(path: 'hide' | 'restore') {
    const body = path === 'hide' ? { reason } : undefined;
    if (await run(() => api('POST', `/admin/reviews/${id}/${path}`, body))) {
      setAsking(false);
      setReason('');
      router.refresh();
    }
  }

  if (hidden) {
    return (
      <div className="flex flex-col gap-1">
        <Button size="sm" variant="secondary" loading={pending} onClick={() => void act('restore')}>
          Restore
        </Button>
        {error && <span className="text-xs text-error">{error.message}</span>}
      </div>
    );
  }
  if (!asking) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>
        Hide
      </Button>
    );
  }
  return (
    <div className="flex min-w-56 flex-col gap-2">
      <Input
        aria-label="Reason for hiding"
        placeholder="Reason (kept in the audit log)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
      />
      <div className="flex gap-2">
        <Button size="sm" variant="danger" loading={pending} onClick={() => void act('hide')}>
          Hide review
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
          Cancel
        </Button>
      </div>
      {error && <Alert tone="error">{error.message}</Alert>}
    </div>
  );
}
