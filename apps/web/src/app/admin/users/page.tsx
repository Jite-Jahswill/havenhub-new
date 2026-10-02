import type { AdminUserListItem, Paginated } from '@havenhub/shared';
import { Badge } from '@havenhub/ui';
import type { Metadata } from 'next';

import { Filters } from '@/components/admin/filters';
import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { UserStatusAction } from '@/components/admin/user-status-action';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { UserStatusBadge } from '@/components/dashboard/status-badge';
import { serverApi } from '@/lib/api/server';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Users' };

const ACCOUNT_TYPES: [string, string][] = [
  ['CUSTOMER', 'Customers'],
  ['AGENT', 'Agents'],
  ['ADMIN', 'Administrators'],
];

const str = (value: string | string[] | undefined) =>
  typeof value === 'string' && value ? value : undefined;

export default async function AdminUsersPage({ searchParams }: PageProps<'/admin/users'>) {
  const user = await requireUser('ADMIN', '/admin/users');
  const sp = await searchParams;
  const params = { search: str(sp.search), accountType: str(sp.accountType), page: str(sp.page) };
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const res = await serverApi<Paginated<AdminUserListItem>>(`/admin/users?${query}`);
  const canChangeStatus = hasPermission(user, 'users.block');
  const date = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium' });

  return (
    <>
      <PageHeader title="Users" description="Customers, agents and administrators." />
      {!res.success ? (
        res.code === 'INSUFFICIENT_PERMISSIONS' || res.code === 'FORBIDDEN' ? (
          <NoAccess />
        ) : (
          <p className="text-error">{res.message}</p>
        )
      ) : (
        <>
          <Filters
            search={params.search}
            select={{
              name: 'accountType',
              label: 'Account type',
              value: params.accountType,
              options: ACCOUNT_TYPES,
            }}
          />
          <Table caption="Users">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Joined</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.length === 0 && (
                <EmptyRow colSpan={4}>No users match these filters.</EmptyRow>
              )}
              {res.data.items.map((item) => (
                <Tr key={item.id}>
                  <Td>
                    <p className="font-medium">{item.fullName}</p>
                    <p className="text-xs text-text-muted">
                      {item.email}
                      {!item.emailVerified && ' · unverified'}
                    </p>
                  </Td>
                  <Td>
                    <Badge>{item.accountType.toLowerCase()}</Badge>
                    {item.roles.length > 0 && (
                      <p className="mt-1 text-xs text-text-muted">{item.roles.join(', ')}</p>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-text-secondary">
                    {date.format(new Date(item.createdAt))}
                  </Td>
                  <Td>
                    {canChangeStatus && item.id !== user.id ? (
                      <UserStatusAction user={item} />
                    ) : (
                      <UserStatusBadge status={item.status} />
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={res.data} basePath="/admin/users" params={params} />
        </>
      )}
    </>
  );
}
