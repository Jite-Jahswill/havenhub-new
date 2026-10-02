'use client';

import type { AgentExperienceView } from '@havenhub/shared';
import { Alert, Button, Card, CardBody, buttonClasses } from '@havenhub/ui';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { PropertyStatusBadge } from '@/components/dashboard/status-badge';
import { api } from '@/lib/api/client';
import { EXPERIENCE_FIELD_LABELS, experiencePath } from '@/lib/experiences';

const EXPLAIN: Record<AgentExperienceView['status'], string> = {
  DRAFT: 'Only you can see this draft. Submit it for review when it’s complete.',
  PENDING_REVIEW: 'Our team is reviewing this listing. It usually takes 1–2 business days.',
  PUBLISHED: 'Live on HavenHub. Editing content or adding media sends it back for review.',
  REJECTED: 'Changes were requested. Update the listing and resubmit.',
  SUSPENDED: 'This listing has been suspended by HavenHub. Contact support for help.',
  ARCHIVED: 'Archived listings are hidden and don’t count towards your plan.',
};

export function ExperienceStatusPanel({
  experience,
  agentVerified,
}: {
  experience: AgentExperienceView;
  agentVerified: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; code?: string; missing?: string[] } | null>(
    null,
  );

  async function act(action: 'submit' | 'withdraw' | 'archive' | 'restore') {
    if (
      action === 'archive' &&
      !window.confirm('Archive this listing? It will be hidden from the public.')
    )
      return;
    setBusy(action);
    setError(null);
    const res = await api('POST', `/agents/me/experiences/${experience.id}/${action}`);
    setBusy(null);
    if (!res.success)
      setError({
        message: res.message,
        code: res.code,
        missing: (res.details as { missing?: string[] } | undefined)?.missing,
      });
    router.refresh();
  }

  const canSubmit = experience.status === 'DRAFT' || experience.status === 'REJECTED';
  const missing = experience.missingForSubmission;
  const label = (field: string) => EXPERIENCE_FIELD_LABELS[field] ?? field;

  return (
    <Card>
      <CardBody className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-text">Status</span>
          <PropertyStatusBadge status={experience.status} />
        </div>
        <p className="text-sm text-text-secondary">{EXPLAIN[experience.status]}</p>

        {experience.moderationNote &&
          (experience.status === 'REJECTED' || experience.status === 'SUSPENDED') && (
            <div className="rounded-control bg-error-subtle px-4 py-3 text-sm text-error">
              <p className="font-semibold">Note from HavenHub</p>
              <p className="mt-1 break-words">{experience.moderationNote}</p>
            </div>
          )}

        {canSubmit && missing.length > 0 && (
          <div className="text-sm">
            <p className="font-medium text-text">Still needed before review:</p>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-text-secondary">
              {missing.map((field) => (
                <li key={field}>{label(field)}</li>
              ))}
            </ul>
          </div>
        )}
        {canSubmit && !agentVerified && (
          <Alert tone="warning">
            Your account must be verified before listings can go live.{' '}
            <Link href="/agent/profile" className="font-semibold underline">
              Complete verification
            </Link>
          </Alert>
        )}
        {error && (
          <Alert tone="error">
            {error.message}
            {error.missing && ` Still needed: ${error.missing.map(label).join(', ')}.`}
            {error.code === 'PLAN_LIMIT_REACHED' && (
              <Link href="/agent/subscription/plans" className="ml-1 font-semibold underline">
                View plans
              </Link>
            )}
          </Alert>
        )}

        <div className="flex flex-col gap-2">
          {canSubmit && (
            <Button
              onClick={() => act('submit')}
              loading={busy === 'submit'}
              disabled={missing.length > 0 || !agentVerified}
            >
              {experience.status === 'REJECTED' ? 'Resubmit for review' : 'Submit for review'}
            </Button>
          )}
          {experience.status === 'PENDING_REVIEW' && (
            <Button
              variant="secondary"
              onClick={() => act('withdraw')}
              loading={busy === 'withdraw'}
            >
              Withdraw to edit
            </Button>
          )}
          {experience.status === 'PUBLISHED' && (
            <Link
              href={experiencePath(experience.kind, experience.slug)}
              target="_blank"
              className={buttonClasses({ variant: 'secondary' })}
            >
              View live listing <ExternalLink aria-hidden className="size-4" />
            </Link>
          )}
          {experience.status === 'ARCHIVED' && (
            <Button variant="secondary" onClick={() => act('restore')} loading={busy === 'restore'}>
              Restore as draft
            </Button>
          )}
          {experience.status !== 'ARCHIVED' && experience.status !== 'SUSPENDED' && (
            <Button variant="ghost" onClick={() => act('archive')} loading={busy === 'archive'}>
              Archive listing
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
