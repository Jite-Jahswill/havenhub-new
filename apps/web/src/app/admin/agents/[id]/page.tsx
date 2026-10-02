import type { AdminAgentDetail } from '@havenhub/shared';
import { Card, CardBody, CardHeader } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { AgentReview } from '@/components/admin/agent-review';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { UserStatusBadge, VerificationBadge } from '@/components/dashboard/status-badge';
import { serverApi } from '@/lib/api/server';
import { ID_DOCUMENT_LABELS, SERVICE_LABELS } from '@/lib/labels';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Agent review' };

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-text">{children || '—'}</dd>
    </div>
  );
}

export default async function AdminAgentDetailPage({ params }: PageProps<'/admin/agents/[id]'>) {
  const user = await requireUser('ADMIN', '/admin/agents');
  const { id } = await params;
  const res = await serverApi<AdminAgentDetail>(`/admin/agents/${encodeURIComponent(id)}`);
  if (!res.success) {
    if (res.code === 'NOT_FOUND' || res.code === 'BAD_REQUEST') notFound();
    return <NoAccess />;
  }
  const agent = res.data;
  const p = agent.profile;
  const canReview = hasPermission(user, 'agents.verify') || hasPermission(user, 'agents.suspend');
  const date = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <>
      <Link href="/admin/agents" className="text-sm text-text-secondary hover:text-text">
        ← All agents
      </Link>
      <div className="mt-4">
        <PageHeader
          title={p.businessName ?? agent.fullName}
          description={agent.email}
          action={<VerificationBadge status={agent.verificationStatus} />}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Account" />
            <CardBody>
              <dl className="grid gap-5 sm:grid-cols-2">
                <Detail label="Full name">{agent.fullName}</Detail>
                <Detail label="Phone">{agent.phone}</Detail>
                <Detail label="Email verified">{agent.emailVerified ? 'Yes' : 'No'}</Detail>
                <Detail label="Account status">
                  <UserStatusBadge status={agent.userStatus} />
                </Detail>
                <Detail label="Sex">{p.sex === 'FEMALE' ? 'Female' : 'Male'}</Detail>
                <Detail label="Services">
                  {p.serviceTypes.map((s) => SERVICE_LABELS[s]).join(', ')}
                </Detail>
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Address" />
            <CardBody>
              <dl className="grid gap-5 sm:grid-cols-2">
                <Detail label="Street">{p.addressLine}</Detail>
                <Detail label="City / town">{p.city}</Detail>
                <Detail label="LGA">{p.lga}</Detail>
                <Detail label="State">{p.state}</Detail>
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Identity & payout"
              description="Sensitive values are shown masked only."
            />
            <CardBody>
              <dl className="grid gap-5 sm:grid-cols-2">
                <Detail label="NIN">{p.identity.ninMasked}</Detail>
                <Detail label="ID document">
                  {p.identity.idDocumentType && ID_DOCUMENT_LABELS[p.identity.idDocumentType]}
                </Detail>
                <Detail label="Bank">{p.payoutAccount?.bankName}</Detail>
                <Detail label="Account">
                  {p.payoutAccount &&
                    `${p.payoutAccount.accountNumberMasked} · ${p.payoutAccount.accountName}`}
                </Detail>
              </dl>
            </CardBody>
          </Card>
        </div>
        <Card className="self-start">
          <CardHeader
            title="Verification"
            description={
              p.verificationSubmittedAt
                ? `Submitted ${date.format(new Date(p.verificationSubmittedAt))}`
                : 'Not yet submitted'
            }
          />
          <CardBody>
            {p.verificationNote && (
              <p className="mb-5 rounded-control bg-surface-secondary px-4 py-3 text-sm">
                <span className="font-semibold">Last note: </span>
                {p.verificationNote}
              </p>
            )}
            {canReview ? (
              <AgentReview agent={agent} />
            ) : (
              <p className="text-sm text-text-secondary">
                You can view this agent but not change their verification.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
