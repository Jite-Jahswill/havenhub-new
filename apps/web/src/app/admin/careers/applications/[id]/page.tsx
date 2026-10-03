import { APPLICATION_STATUS_LABELS, type AdminApplicationView } from '@havenhub/shared';
import { Badge, Card, CardBody, CardHeader, buttonClasses } from '@havenhub/ui';
import { Download } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ApplicationActions } from '@/components/admin/cms/application-actions';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { formatMoment } from '@/lib/format';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Application', robots: { index: false } };

export default async function ApplicationPage({
  params,
}: PageProps<'/admin/careers/applications/[id]'>) {
  await requireUser('ADMIN', '/admin/careers/applications');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await serverApi<AdminApplicationView>(`/admin/careers/applications/${id}`);
  if (!res.success) {
    if (res.code === 'NOT_FOUND') notFound();
    return <NoAccess />;
  }
  const a = res.data;
  return (
    <>
      <Link
        href="/admin/careers/applications"
        className="text-sm text-text-secondary hover:text-text"
      >
        ← Applications
      </Link>
      <div className="mt-4">
        <PageHeader
          title={a.fullName}
          description={`Applied for ${a.job.title} · ${formatMoment(a.createdAt)}`}
          action={<Badge>{APPLICATION_STATUS_LABELS[a.status]}</Badge>}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title="Applicant" />
          <CardBody className="flex flex-col gap-4 text-sm">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-text-muted">Email</dt>
                <dd className="break-all text-text">
                  <a href={`mailto:${a.email}`} className="underline">
                    {a.email}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Phone</dt>
                <dd className="text-text">{a.phone}</dd>
              </div>
            </dl>
            <div>
              <h3 className="text-xs text-text-muted">Cover note</h3>
              <p className="mt-1 break-words whitespace-pre-line text-text">{a.coverNote ?? '—'}</p>
            </div>
            <div>
              <h3 className="text-xs text-text-muted">CV</h3>
              {a.cv ? (
                <a
                  href={`/api/v1/admin/careers/applications/${a.id}/cv`}
                  className={buttonClasses({ variant: 'secondary', className: 'mt-2' })}
                >
                  <Download aria-hidden className="size-4" /> Download {a.cv.fileName} (
                  {Math.ceil(a.cv.bytes / 1024)} KB)
                </a>
              ) : (
                <p className="mt-1 text-text-secondary">
                  {a.cvDeletedAt
                    ? `Deleted ${formatMoment(a.cvDeletedAt)} (retention policy).`
                    : 'No CV.'}
                </p>
              )}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Decision"
            description={a.reviewedBy ? `Last updated by ${a.reviewedBy}` : undefined}
          />
          <CardBody>
            <ApplicationActions application={a} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
