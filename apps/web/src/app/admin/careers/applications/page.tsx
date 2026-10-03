import {
  APPLICATION_STATUS_LABELS,
  type AdminApplicationListItem,
  type Paginated,
} from '@havenhub/shared';
import { Badge } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Filters } from '@/components/admin/filters';
import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { formatDate } from '@/lib/format';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Job applications' };
const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);
const STATUSES = Object.entries<string>(APPLICATION_STATUS_LABELS);

/** Applicant personal data: visible only with `careers.applications` (enforced by the API). */
export default async function ApplicationsPage({
  searchParams,
}: PageProps<'/admin/careers/applications'>) {
  await requireUser('ADMIN', '/admin/careers/applications');
  const sp = await searchParams;
  const jobId = str(sp.jobId);
  const params = {
    status: str(sp.status),
    page: str(sp.page),
    jobId: jobId && /^[0-9a-f-]{36}$/i.test(jobId) ? jobId : undefined,
  };
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const res = await serverApi<Paginated<AdminApplicationListItem>>(
    `/admin/careers/applications?${query}`,
  );
  return (
    <>
      <Link href="/admin/careers" className="text-sm text-text-secondary hover:text-text">
        ← Careers
      </Link>
      <div className="mt-4">
        <PageHeader
          title="Applications"
          description="Applicant details are personal data. Every view and CV download is recorded in the audit log."
        />
      </div>
      {!res.success ? (
        <NoAccess />
      ) : (
        <>
          <Filters
            searchable={false}
            select={{ name: 'status', label: 'Status', value: params.status, options: STATUSES }}
            hidden={params.jobId ? { jobId: params.jobId } : {}}
          />
          <Table caption="Applications">
            <thead>
              <tr>
                <Th>Applicant</Th>
                <Th>Job</Th>
                <Th>Received</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.length === 0 && <EmptyRow colSpan={4}>No applications.</EmptyRow>}
              {res.data.items.map((a) => (
                <Tr key={a.id} className="hover:bg-surface-secondary/60">
                  <Td>
                    <Link
                      href={`/admin/careers/applications/${a.id}`}
                      className="font-medium hover:underline"
                    >
                      {a.fullName}
                    </Link>
                    <p className="text-xs break-all text-text-muted">{a.email}</p>
                  </Td>
                  <Td className="text-text-secondary">{a.job.title}</Td>
                  <Td className="whitespace-nowrap text-text-secondary">
                    {formatDate(a.createdAt)}
                  </Td>
                  <Td>
                    <Badge
                      tone={
                        a.status === 'HIRED'
                          ? 'success'
                          : a.status === 'REJECTED'
                            ? 'neutral'
                            : 'warning'
                      }
                    >
                      {APPLICATION_STATUS_LABELS[a.status]}
                    </Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={res.data} basePath="/admin/careers/applications" params={params} />
        </>
      )}
    </>
  );
}
