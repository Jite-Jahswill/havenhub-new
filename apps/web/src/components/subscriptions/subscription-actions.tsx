'use client';

import type { CurrentSubscriptionView } from '@havenhub/shared';
import { Alert, Button } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { api } from '@/lib/api/client';
import { useApiAction } from '@/lib/use-api-action';

/**
 * Cancel (at period end, or now) and undo. Cancelling asks for explicit
 * confirmation in place and states the consequence before anything happens.
 */
export function SubscriptionActions({
  cancelAtPeriodEnd,
  periodEnd,
  planName,
}: {
  cancelAtPeriodEnd: boolean;
  periodEnd: string;
  planName: string;
}) {
  const router = useRouter();
  const { pending, error, run } = useApiAction();
  const [confirming, setConfirming] = useState(false);
  const [mode, setMode] = useState<'END_OF_PERIOD' | 'IMMEDIATE'>('END_OF_PERIOD');
  const groupId = useId();

  async function cancel() {
    const done = await run(() =>
      api<CurrentSubscriptionView>('POST', '/agents/me/subscription/cancel', { mode }),
    );
    if (done) {
      setConfirming(false);
      router.refresh();
    }
  }

  async function resume() {
    const done = await run(() => api('POST', '/agents/me/subscription/resume'));
    if (done) router.refresh();
  }

  if (cancelAtPeriodEnd) {
    return (
      <div className="flex flex-col gap-3">
        {error && <Alert tone="error">{error.message}</Alert>}
        <Button variant="secondary" onClick={resume} loading={pending} className="self-start">
          Keep my plan
        </Button>
      </div>
    );
  }

  if (!confirming) {
    return (
      <Button variant="ghost" onClick={() => setConfirming(true)} className="self-start">
        Cancel subscription
      </Button>
    );
  }

  return (
    <fieldset className="flex flex-col gap-4 rounded-card border border-border p-5">
      <legend className="px-1 text-sm font-semibold text-text">Cancel {planName}?</legend>
      {error && <Alert tone="error">{error.message}</Alert>}
      <label className="flex gap-3 text-sm" htmlFor={`${groupId}-end`}>
        <input
          id={`${groupId}-end`}
          type="radio"
          name={groupId}
          checked={mode === 'END_OF_PERIOD'}
          onChange={() => setMode('END_OF_PERIOD')}
          className="mt-1 size-4 accent-primary"
        />
        <span>
          <span className="font-medium text-text">At the end of the paid term</span>
          <span className="block text-text-secondary">
            Keep {planName} until {periodEnd}, then move to the free plan.
          </span>
        </span>
      </label>
      <label className="flex gap-3 text-sm" htmlFor={`${groupId}-now`}>
        <input
          id={`${groupId}-now`}
          type="radio"
          name={groupId}
          checked={mode === 'IMMEDIATE'}
          onChange={() => setMode('IMMEDIATE')}
          className="mt-1 size-4 accent-primary"
        />
        <span>
          <span className="font-medium text-text">Immediately</span>
          <span className="block text-text-secondary">
            Move to the free plan now. Unused time is not refunded.
          </span>
        </span>
      </label>
      <p className="text-sm text-text-secondary">
        Nothing is deleted either way. Listings above the free plan&apos;s limits stay as they are,
        but you will not be able to add more.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button variant="danger" onClick={cancel} loading={pending}>
          Confirm cancellation
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
          Keep my plan
        </Button>
      </div>
    </fieldset>
  );
}
