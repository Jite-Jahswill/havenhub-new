'use client';

import type { AdminSubscriptionPlanView, SubscriptionPlanStatus } from '@havenhub/shared';
import { Alert, Button } from '@havenhub/ui';
import { useRouter } from 'next/navigation';

import { api } from '@/lib/api/client';
import { useApiAction } from '@/lib/use-api-action';

/** Offer / stop offering / archive / delete a plan. Destructive steps ask first. */
export function PlanStatusActions({ plan }: { plan: AdminSubscriptionPlanView }) {
  const router = useRouter();
  const { pending, error, run } = useApiAction();

  async function setStatus(status: SubscriptionPlanStatus) {
    if (
      status === 'ARCHIVED' &&
      !window.confirm(
        `Archive ${plan.name}? It will never be offered again. Current subscribers keep it until their term ends.`,
      )
    )
      return;
    const done = await run(() =>
      api('POST', `/admin/subscription-plans/${plan.id}/status`, { status }),
    );
    if (done) router.refresh();
  }

  async function remove() {
    if (!window.confirm(`Delete ${plan.name}? This cannot be undone.`)) return;
    const done = await run(() => api('DELETE', `/admin/subscription-plans/${plan.id}`));
    if (done) router.push('/admin/plans');
  }

  if (plan.isDefault) {
    return <p className="text-sm text-text-secondary">The free default plan is always offered.</p>;
  }
  if (plan.status === 'ARCHIVED') {
    return <p className="text-sm text-text-secondary">Archived plans are kept for history only.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="error">{error.message}</Alert>}
      {plan.status === 'ACTIVE' ? (
        <Button variant="secondary" onClick={() => setStatus('INACTIVE')} loading={pending}>
          Stop offering
        </Button>
      ) : (
        <Button onClick={() => setStatus('ACTIVE')} loading={pending}>
          Offer to agents
        </Button>
      )}
      <Button variant="ghost" onClick={() => setStatus('ARCHIVED')} disabled={pending}>
        Archive
      </Button>
      {plan.canDelete && (
        <Button variant="danger" onClick={remove} disabled={pending}>
          Delete plan
        </Button>
      )}
    </div>
  );
}
