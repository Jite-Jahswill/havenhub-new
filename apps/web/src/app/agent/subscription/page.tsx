import type { AgentPlanUsageView } from '@havenhub/shared';
import { Alert } from '@havenhub/ui';
import type { Metadata } from 'next';

import { PlanCard } from '@/components/agent/plan-card';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApiData } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Subscription' };

export default async function AgentSubscriptionPage() {
  const plan = await serverApiData<AgentPlanUsageView>('/agents/me/plan');
  return (
    <>
      <PageHeader title="Subscription" description="Your plan and what it includes." />
      <div className="flex max-w-2xl flex-col gap-6">
        {plan && <PlanCard plan={plan} />}
        <Alert>
          Paid plans — with more properties, media and featured listings — are coming soon.
          Upgrades, renewals and payment history will appear here.
        </Alert>
      </div>
    </>
  );
}
