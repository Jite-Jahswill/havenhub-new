import type { AuditLogView, Paginated } from '@havenhub/shared';
import { Alert, Button, Input } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { formatMoment } from '@/lib/format';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Audit log' };

const FIELDS = ['actor', 'action', 'resourceType', 'resourceId', 'from', 'to', 'page'] as const;

export default async function AuditLogsPage({ searchParams }: PageProps<'/admin/audit-logs'>) {
  await requireUser('ADMIN', '/admin/audit-logs');
  const sp = await searchParams;
  const params = Object.fromEntries(
    FIELDS.map((k) => [k, typeof sp[k] === 'string' && sp[k] ? sp[k] : undefined]),
  ) as Record<(typeof FIELDS)[number], string | undefined>;
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const res = await serverApi<Paginated<AuditLogView>>(`/admin/audit-logs?${query}`);
  const forbidden =
    !res.success && (res.code === 'INSUFFICIENT_PERMISSIONS' || res.code === 'FORBIDDEN');

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every administrative and security-relevant action, newest first. Entries cannot be edited or deleted."
      />
      {forbidden ? (
        <NoAccess />
      ) : (
        <>
          <form
            role="search"
            aria-label="Filter the audit log"
            className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            <Input
              name="actor"
              defaultValue={params.actor}
              placeholder="Actor email, name or id"
              aria-label="Actor"
            />
            <Input
              name="action"
              defaultValue={params.action}
              placeholder='Action, or a prefix like "property."'
              aria-label="Action"
            />
            <Input
              name="resourceType"
              defaultValue={params.resourceType}
              placeholder="Resource type (e.g. user)"
              aria-label="Resource type"
            />
            <Input
              name="resourceId"
              defaultValue={params.resourceId}
              placeholder="Resource id"
              aria-label="Resource id"
            />
            <div className="grid grid-cols-2 gap-3">
              <Input type="date" name="from" defaultValue={params.from} aria-label="From date" />
              <Input type="date" name="to" defaultValue={params.to} aria-label="To date" />
            </div>
            <div className="flex gap-3">
              <Button type="submit" variant="secondary">
                Filter
              </Button>
              <Link
                href="/admin/audit-logs"
                className="self-center text-sm text-text-secondary hover:text-text"
              >
                Clear
              </Link>
            </div>
          </form>
          {!res.success ? (
            <Alert tone="error">{res.message}</Alert>
          ) : (
            <>
              <Table caption="Audit log entries">
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Actor</Th>
                    <Th>Action</Th>
                    <Th>Resource</Th>
                  </tr>
                </thead>
                <tbody>
                  {res.data.items.length === 0 && (
                    <EmptyRow colSpan={4}>No entries match these filters.</EmptyRow>
                  )}
                  {res.data.items.map((item) => (
                    <Tr key={item.id}>
                      <Td className="whitespace-nowrap text-text-secondary">
                        <Link
                          href={`/admin/audit-logs/${item.id}`}
                          className="hover:text-text hover:underline"
                        >
                          {formatMoment(item.createdAt)}
                        </Link>
                      </Td>
                      <Td>
                        {item.actor ? (
                          <>
                            <p className="font-medium">{item.actor.fullName}</p>
                            <p className="text-xs break-all text-text-muted">{item.actor.email}</p>
                          </>
                        ) : (
                          <span className="text-text-muted">System</span>
                        )}
                      </Td>
                      <Td>
                        <Link
                          href={`/admin/audit-logs/${item.id}`}
                          className="font-mono text-xs break-all text-text hover:underline"
                        >
                          {item.action}
                        </Link>
                      </Td>
                      <Td className="text-xs text-text-secondary">
                        <p>{item.resourceType}</p>
                        {item.resourceId && (
                          <p className="font-mono break-all">{item.resourceId}</p>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <Pagination page={res.data} basePath="/admin/audit-logs" params={params} />
            </>
          )}
        </>
      )}
    </>
  );
}
