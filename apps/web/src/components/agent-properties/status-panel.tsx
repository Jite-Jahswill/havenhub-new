'use client';

import type { AgentPropertyView } from '@havenhub/shared';
import { Alert, Button, Card, CardBody, buttonClasses } from '@havenhub/ui';
import { Eye, ExternalLink, Heart } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { PropertyStatusBadge } from '@/components/dashboard/status-badge';
import { api } from '@/lib/api/client';
import { PROPERTY_FIELD_LABELS } from '@/lib/labels';

const EXPLAIN: Record<AgentPropertyView['status'], string> = {
  DRAFT: 'Only you can see this draft. Submit it for review when it’s complete.',
  PENDING_REVIEW: 'Our team is reviewing this listing. It usually takes 1–2 business days.',
  PUBLISHED: 'Live on HavenHub. Editing content or adding media sends it back for review.',
  REJECTED: 'Changes were requested. Update the listing and resubmit.',
  SUSPENDED: 'This listing has been suspended by HavenHub. Contact support for help.',
  ARCHIVED: 'Archived listings are hidden and don’t count towards your plan.',
};

export function StatusPanel({
  property,
  agentVerified,
}: {
  property: AgentPropertyView;
  agentVerified: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{
    message: string;
    code?: string;
    missing?: string[];
  } | null>(null);

  async function act(action: 'submit' | 'withdraw' | 'archive' | 'restore') {
    if (
      action === 'archive' &&
      !window.confirm('Archive this listing? It will be hidden from the public.')
    )
      return;
    setBusy(action);
    setError(null);
    const res = await api('POST', `/agents/me/properties/${property.id}/${action}`);
    setBusy(null);
    if (!res.success)
      setError({
        message: res.message,
        code: res.code,
        missing: (res.details as { missing?: string[] } | undefined)?.missing,
      });
    router.refresh();
  }

  const canSubmit = property.status === 'DRAFT' || property.status === 'REJECTED';
  const missing = property.missingForSubmission;

  return (
    <Card>
      <CardBody className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-text">Status</span>
          <PropertyStatusBadge status={property.status} />
        </div>
        <p className="text-sm text-text-secondary">{EXPLAIN[property.status]}</p>

        {property.moderationNote &&
          (property.status === 'REJECTED' || property.status === 'SUSPENDED') && (
            <div className="rounded-control bg-error-subtle px-4 py-3 text-sm text-error">
              <p className="font-semibold">Note from HavenHub</p>
              <p className="mt-1">{property.moderationNote}</p>
            </div>
          )}

        {canSubmit && missing.length > 0 && (
          <div className="text-sm">
            <p className="font-medium text-text">Still needed before review:</p>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-text-secondary">
              {missing.map((field) => (
                <li key={field}>{PROPERTY_FIELD_LABELS[field] ?? field}</li>
              ))}
            </ul>
          </div>
        )}
        {canSubmit && !agentVerified && (
          <Alert tone="warning">
            Your agent account must be verified before listings can go live.{' '}
            <Link href="/agent/profile" className="font-semibold underline">
              Complete verification
            </Link>
          </Alert>
        )}
        {error && (
          <Alert tone="error">
            {error.message}
            {error.missing &&
              ` Still needed: ${error.missing.map((m) => PROPERTY_FIELD_LABELS[m] ?? m).join(', ')}.`}
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
              {property.status === 'REJECTED' ? 'Resubmit for review' : 'Submit for review'}
            </Button>
          )}
          {property.status === 'PENDING_REVIEW' && (
            <Button
              variant="secondary"
              onClick={() => act('withdraw')}
              loading={busy === 'withdraw'}
            >
              Withdraw to edit
            </Button>
          )}
          {property.status === 'PUBLISHED' && (
            <Link
              href={`/properties/${property.slug}`}
              target="_blank"
              className={buttonClasses({ variant: 'secondary' })}
            >
              View live listing <ExternalLink aria-hidden className="size-4" />
            </Link>
          )}
          {property.status === 'ARCHIVED' && (
            <Button variant="secondary" onClick={() => act('restore')} loading={busy === 'restore'}>
              Restore as draft
            </Button>
          )}
          {property.status !== 'ARCHIVED' && property.status !== 'SUSPENDED' && (
            <Button variant="ghost" onClick={() => act('archive')} loading={busy === 'archive'}>
              Archive listing
            </Button>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-3 border-t border-border pt-5 text-sm">
          <div className="flex items-center gap-2 text-text-secondary">
            <Eye aria-hidden className="size-4" />
            <dt className="sr-only">Views</dt>
            <dd>
              <span className="font-semibold text-text">{property.stats.views}</span> views
            </dd>
          </div>
          <div className="flex items-center gap-2 text-text-secondary">
            <Heart aria-hidden className="size-4" />
            <dt className="sr-only">Favourites</dt>
            <dd>
              <span className="font-semibold text-text">{property.stats.favorites}</span> saves
            </dd>
          </div>
        </dl>
      </CardBody>
    </Card>
  );
}
