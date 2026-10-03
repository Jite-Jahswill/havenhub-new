import type { AdminJobView, Paginated } from '@havenhub/shared';
import { EMPLOYMENT_TYPE_LABELS } from '@havenhub/shared';
import { buttonClasses } from '@havenhub/ui';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { JobStatusBadge } from '@/components/admin/cms/job-editor';
import { Filters } from '@/components/admin/filters';
import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { getSite } from '@/lib/cms';
import { formatDate } from '@/lib/format';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Careers' };
const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);
const STATUSES: [string, string][] = [
  ['DRAFT', 'Draft'],
  ['PUBLISHED', 'Open'],
  ['CLOSED', 'Closed'],
  ['ARCHIVED', 'Archived'],
];

export default async function AdminCareersPage({ searchParams }: PageProps<'/admin/careers'>) {
  const user = await requireUser('ADMIN', '/admin/careers');
  const sp = await searchParams;
  const params = { search: str(sp.search), status: str(sp.status), page: str(sp.page) };
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const [res, site] = await Promise.all([
    serverApi<Paginated<AdminJobView>>(`/admin/careers/jobs?${query}`),
    getSite(),
  ]);
  return (
    <>
      <PageHeader
        title="Careers"
        description={
          site.features.careers
            ? 'The careers page is live.'
            : 'The careers page is switched off in site settings.'
        }
        action={
          <div className="flex flex-wrap gap-2">
            {hasPermission(user, 'careers.applications') && (
              <Link
                href="/admin/careers/applications"
                className={buttonClasses({ variant: 'secondary' })}
              >
                Applications
              </Link>
            )}
            {res.success && (
              <Link href="/admin/careers/new" className={buttonClasses()}>
                <Plus aria-hidden className="size-4" /> New job
              </Link>
            )}
          </div>
        }
      />
      {!res.success ? (
        <NoAccess />
      ) : (
        <>
          <Filters
            search={params.search}
            placeholder="Search jobs"
            select={{ name: 'status', label: 'Status', value: params.status, options: STATUSES }}
          />
          <Table caption="Jobs">
            <thead>
              <tr>
                <Th>Job</Th>
                <Th>Applications</Th>
                <Th>Updated</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.length === 0 && <EmptyRow colSpan={4}>No jobs yet.</EmptyRow>}
              {res.data.items.map((j) => (
                <Tr key={j.id} className="hover:bg-surface-secondary/60">
                  <Td>
                    <Link href={`/admin/careers/${j.id}`} className="font-medium hover:underline">
                      {j.title}
                    </Link>
                    <p className="text-xs text-text-muted">
                      {j.location} · {EMPLOYMENT_TYPE_LABELS[j.employmentType]}
                    </p>
                  </Td>
                  <Td className="text-text-secondary">{j.applicationCount}</Td>
                  <Td className="whitespace-nowrap text-text-secondary">
                    {formatDate(j.updatedAt)}
                  </Td>
                  <Td>
                    <JobStatusBadge status={j.status} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={res.data} basePath="/admin/careers" params={params} />
        </>
      )}
    </>
  );
}
