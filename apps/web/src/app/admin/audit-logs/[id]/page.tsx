import type { AuditLogDetail } from '@havenhub/shared';
import { Card, CardBody, CardHeader } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { formatMoment } from '@/lib/format';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Audit entry' };

/** Rendered as text (never HTML): snapshots are data written by the API. */
function Snapshot({ title, value }: { title: string; value: unknown }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        {value === null || value === undefined ? (
          <p className="text-sm text-text-muted">Not recorded.</p>
        ) : (
          <pre className="max-h-96 overflow-auto rounded-control bg-surface-secondary p-4 text-xs leading-relaxed break-all whitespace-pre-wrap text-text">
            {JSON.stringify(value, null, 2)}
          </pre>
        )}
      </CardBody>
    </Card>
  );
}

export default async function AuditEntryPage({ params }: PageProps<'/admin/audit-logs/[id]'>) {
  await requireUser('ADMIN', '/admin/audit-logs');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await serverApi<AuditLogDetail>(`/admin/audit-logs/${id}`);
  if (!res.success) {
    if (res.code === 'NOT_FOUND') notFound();
    return <NoAccess />;
  }
  const e = res.data;
  const facts: [string, string][] = [
    ['When', formatMoment(e.createdAt)],
    ['Actor', e.actor ? `${e.actor.fullName} (${e.actor.email})` : 'System'],
    ['Resource', `${e.resourceType}${e.resourceId ? ` · ${e.resourceId}` : ''}`],
    ['IP address', e.ipAddress ?? 'Not recorded'],
    ['Device', e.userAgent ?? 'Not recorded'],
  ];
  return (
    <>
      <Link href="/admin/audit-logs" className="text-sm text-text-secondary hover:text-text">
        ← Audit log
      </Link>
      <div className="mt-4">
        <PageHeader title={e.action} />
      </div>
      <Card className="mb-6">
        <CardBody>
          <dl className="grid gap-4 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
            {facts.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-text-muted">{label}</dt>
                <dd className="break-words text-text">{value}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Snapshot title="Before" value={e.before} />
        <Snapshot title="After" value={e.after} />
      </div>
    </>
  );
}
