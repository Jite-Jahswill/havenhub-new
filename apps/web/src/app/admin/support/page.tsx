import type { Paginated, SupportConversationItem } from '@havenhub/shared';
import { Badge, buttonClasses } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { SupportJoin } from '@/components/admin/cms/support-join';
import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { formatMoment } from '@/lib/format';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Support' };
const SCOPES = [
  ['unassigned', 'Waiting for support'],
  ['mine', 'Mine'],
  ['all', 'All'],
] as const;

export default async function AdminSupportPage({ searchParams }: PageProps<'/admin/support'>) {
  await requireUser('ADMIN', '/admin/support');
  const sp = await searchParams;
  const scope = SCOPES.some(([k]) => k === sp.scope) ? (sp.scope as string) : 'unassigned';
  const page = typeof sp.page === 'string' && /^\d{1,4}$/.test(sp.page) ? sp.page : '1';
  const res = await serverApi<Paginated<SupportConversationItem>>(
    `/admin/support/conversations?scope=${scope}&page=${page}`,
  );
  const chip =
    'rounded-full border border-border px-3.5 py-1.5 text-sm font-medium text-text hover:bg-surface-secondary aria-[current=page]:bg-surface-inverse aria-[current=page]:text-text-inverse';
  return (
    <>
      <PageHeader
        title="Support"
        description="Requests from customers and agents. Join one to reply — it then appears in your Messages."
        action={
          res.success ? (
            <Link href="/admin/messages" className={buttonClasses({ variant: 'secondary' })}>
              My messages
            </Link>
          ) : undefined
        }
      />
      {!res.success ? (
        <NoAccess />
      ) : (
        <>
          <nav aria-label="Support queue" className="mb-6 flex flex-wrap gap-2">
            {SCOPES.map(([k, label]) => (
              <Link
                key={k}
                href={`/admin/support?scope=${k}`}
                aria-current={scope === k ? 'page' : undefined}
                className={chip}
              >
                {label}
              </Link>
            ))}
          </nav>
          <Table caption="Support conversations">
            <thead>
              <tr>
                <Th>From</Th>
                <Th>Support</Th>
                <Th>Last activity</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.length === 0 && <EmptyRow colSpan={4}>Nothing here.</EmptyRow>}
              {res.data.items.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <p className="font-medium">{c.requester?.name ?? 'Unknown'}</p>
                    <p className="text-xs break-all text-text-muted">
                      {c.requester?.email} · {c.requester?.role === 'AGENT' ? 'Agent' : 'Customer'}
                    </p>
                  </Td>
                  <Td className="text-text-secondary">
                    {c.staff.length ? (
                      c.staff.map((s) => s.name).join(', ')
                    ) : (
                      <Badge tone="warning">Unassigned</Badge>
                    )}
                    {c.status === 'CLOSED' && <Badge className="ml-2">Closed</Badge>}
                  </Td>
                  <Td className="whitespace-nowrap text-text-secondary">
                    {formatMoment(c.lastActivityAt)}
                  </Td>
                  <Td className="text-right">
                    <SupportJoin id={c.id} joined={c.joined} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={res.data} basePath="/admin/support" params={{ scope, page }} />
        </>
      )}
    </>
  );
}
