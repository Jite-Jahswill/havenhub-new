import type { AgentProfileView } from '@havenhub/shared';
import { Card, CardBody, CardHeader } from '@havenhub/ui';
import type { Metadata } from 'next';

import { ProfileForm } from '@/components/account/profile-form';
import {
  BusinessProfileForm,
  IdentityForm,
  PayoutForm,
  SubmitVerification,
} from '@/components/agent/agent-profile-forms';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { VerificationBadge } from '@/components/dashboard/status-badge';
import { serverApiData } from '@/lib/api/server';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Agent profile' };

export default async function AgentProfilePage() {
  const user = await requireUser('AGENT', '/agent/profile');
  const profile = await serverApiData<AgentProfileView>('/agents/me');
  if (!profile) throw new Error('Agent profile could not be loaded');

  return (
    <>
      <PageHeader
        title="Profile"
        description="Your personal details, business profile and verification."
        action={<VerificationBadge status={profile.verificationStatus} />}
      />
      <div className="flex flex-col gap-6">
        <SubmitVerification profile={profile} />
        <Card>
          <CardHeader title="Personal details" />
          <CardBody>
            <ProfileForm user={user} />
          </CardBody>
        </Card>
        <BusinessProfileForm profile={profile} />
        <IdentityForm profile={profile} />
        <PayoutForm profile={profile} />
      </div>
    </>
  );
}
