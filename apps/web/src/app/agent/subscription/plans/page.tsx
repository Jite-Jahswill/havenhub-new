import type { CurrentSubscriptionView, SubscriptionPlanView } from '@havenhub/shared';
import { Alert } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { PlanComparison } from '@/components/subscriptions/plan-comparison';
import { serverApi } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Plans' };

export default async function AgentPlansPage() {
  const [plans, current] = await Promise.all([
    serverApi<SubscriptionPlanView[]>('/subscriptions/plans'),
    serverApi<CurrentSubscriptionView>('/agents/me/subscription'),
  ]);
  if (!plans.success || !current.success) {
    return (
      <>
        <PageHeader title="Plans" />
        <Alert tone="error">
          {plans.success ? (current.success ? '' : current.message) : plans.message}
        </Alert>
      </>
    );
  }
  const now = current.data;
  const currentRank = now.plan.rank;
  return (
    <>
      <Link href="/agent/subscription" className="text-sm text-text-secondary hover:text-text">
        ← Subscription
      </Link>
      <div className="mt-4">
        <PageHeader
          title="Plans"
          description="Compare what each plan includes. You see the exact price and when it applies before you pay."
        />
      </div>
      {now.scheduled && (
        <Alert className="mb-6">
          You already have a plan change scheduled ({now.scheduled.plan.name}). You can choose
          another plan once it starts.
        </Alert>
      )}
      <PlanComparison
        plans={plans.data}
        currentPlanId={now.plan.id}
        actionFor={(plan) =>
          plan.isDefault || now.scheduled
            ? null
            : {
                href: `/agent/subscription/checkout?plan=${plan.id}`,
                label:
                  plan.id === now.plan.id
                    ? 'Renew'
                    : now.plan.isDefault || plan.rank > currentRank
                      ? `Choose ${plan.name}`
                      : `Switch to ${plan.name}`,
              }
        }
      />
    </>
  );
}
