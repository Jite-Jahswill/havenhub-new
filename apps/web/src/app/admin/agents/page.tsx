import type { AdminAgentListItem, Paginated } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Filters } from '@/components/admin/filters';
import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { VerificationBadge, verificationLabel } from '@/components/dashboard/status-badge';
import { serverApi } from '@/lib/api/server';
import { SERVICE_LABELS } from '@/lib/labels';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Agents' };

const STATUSES = (
  ['UNDER_REVIEW', 'PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED', 'BLOCKED'] as const
).map((s): [string, string] => [s, verificationLabel(s)]);

const str = (value: string | string[] | undefined) =>
  typeof value === 'string' && value ? value : undefined;

export default async function AdminAgentsPage({ searchParams }: PageProps<'/admin/agents'>) {
  await requireUser('ADMIN', '/admin/agents');
  const sp = await searchParams;
  const params = {
    search: str(sp.search),
    verificationStatus: str(sp.verificationStatus),
    page: str(sp.page),
  };
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const res = await serverApi<Paginated<AdminAgentListItem>>(`/admin/agents?${query}`);

  return (
    <>
      <PageHeader title="Agents" description="Review verification submissions and manage agents." />
      {!res.success ? (
        <NoAccess />
      ) : (
        <>
          <Filters
            search={params.search}
            select={{
              name: 'verificationStatus',
              label: 'Verification status',
              value: params.verificationStatus,
              options: STATUSES,
            }}
          />
          <Table caption="Agents">
            <thead>
              <tr>
                <Th>Agent</Th>
                <Th>Services</Th>
                <Th>State</Th>
                <Th>Verification</Th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.length === 0 && (
                <EmptyRow colSpan={4}>No agents match these filters.</EmptyRow>
              )}
              {res.data.items.map((agent) => (
                <Tr key={agent.id} className="hover:bg-surface-secondary/60">
                  <Td>
                    <Link
                      href={`/admin/agents/${agent.id}`}
                      className="font-medium hover:underline"
                    >
                      {agent.businessName ?? agent.fullName}
                    </Link>
                    <p className="text-xs text-text-muted">{agent.email}</p>
                  </Td>
                  <Td className="text-text-secondary">
                    {agent.serviceTypes.map((s) => SERVICE_LABELS[s]).join(', ')}
                  </Td>
                  <Td className="text-text-secondary">{agent.state ?? '—'}</Td>
                  <Td>
                    <VerificationBadge status={agent.verificationStatus} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={res.data} basePath="/admin/agents" params={params} />
        </>
      )}
    </>
  );
}
