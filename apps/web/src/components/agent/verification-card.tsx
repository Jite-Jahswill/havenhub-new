import type { AgentProfileView } from '@havenhub/shared';
import { Card, CardBody, CardHeader, buttonClasses } from '@havenhub/ui';
import Link from 'next/link';

import { VerificationBadge } from '@/components/dashboard/status-badge';

const COPY: Record<AgentProfileView['verificationStatus'], string> = {
  PENDING: 'Complete your profile and submit your identity details to get the verified badge.',
  UNDER_REVIEW: 'Our team is reviewing your details. This usually takes 1–2 business days.',
  VERIFIED: 'You’re verified. Customers will see the verified badge on your profile.',
  REJECTED: 'We couldn’t verify your details. Please review the note below, update and resubmit.',
  SUSPENDED: 'Your agent account is suspended. Please contact support.',
  BLOCKED: 'Your agent account is blocked. Please contact support.',
};

export function VerificationCard({ profile }: { profile: AgentProfileView }) {
  const status = profile.verificationStatus;
  const actionable = status === 'PENDING' || status === 'REJECTED';
  return (
    <Card>
      <CardHeader title="Verification" action={<VerificationBadge status={status} />} />
      <CardBody className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">{COPY[status]}</p>
        {profile.verificationNote && (
          <p className="rounded-control bg-surface-secondary px-4 py-3 text-sm text-text">
            <span className="font-semibold">Note from HavenHub: </span>
            {profile.verificationNote}
          </p>
        )}
        {actionable && (
          <div>
            <Link href="/agent/profile" className={buttonClasses({ size: 'sm' })}>
              {status === 'REJECTED' ? 'Update and resubmit' : 'Complete verification'}
            </Link>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
