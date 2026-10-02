import type { AgentOnboardingView, AgentPlanUsageView, AgentProfileView } from '@havenhub/shared';
import type { Metadata } from 'next';

import { OnboardingChecklist } from '@/components/agent/onboarding-checklist';
import { PlanCard } from '@/components/agent/plan-card';
import { VerificationCard } from '@/components/agent/verification-card';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApiData } from '@/lib/api/server';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Agent overview' };

export default async function AgentOverviewPage() {
  const user = await requireUser('AGENT', '/agent');
  const [profile, onboarding, plan] = await Promise.all([
    serverApiData<AgentProfileView>('/agents/me'),
    serverApiData<AgentOnboardingView>('/agents/me/onboarding'),
    serverApiData<AgentPlanUsageView>('/agents/me/plan'),
  ]);

  return (
    <>
      <PageHeader
        title={`Hello, ${user.fullName.split(' ')[0]}`}
        description="Here’s where your HavenHub business stands."
      />
      <div className="flex flex-col gap-6">
        {onboarding && <OnboardingChecklist onboarding={onboarding} />}
        <div className="grid gap-6 xl:grid-cols-2">
          {profile && <VerificationCard profile={profile} />}
          {plan && <PlanCard plan={plan} />}
        </div>
      </div>
    </>
  );
}
