import type { RoleView } from '@havenhub/shared';
import { Alert, Badge, buttonClasses } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { NoAccess } from '@/components/admin/no-access';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { plural } from '@/lib/format';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Roles' };

export default async function RolesPage() {
  await requireUser('ADMIN', '/admin/rbac');
  const res = await serverApi<RoleView[]>('/admin/rbac/roles');
  if (!res.success && (res.code === 'INSUFFICIENT_PERMISSIONS' || res.code === 'FORBIDDEN')) {
    return (
      <>
        <PageHeader title="Roles" />
        <NoAccess />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Roles"
        description="Built-in roles are fixed. Custom roles combine permissions you hold yourself; assign them to administrators from the Users page."
        action={
          <Link href="/admin/rbac/new" className={buttonClasses()}>
            New role
          </Link>
        }
      />
      {!res.success ? (
        <Alert tone="error">{res.message}</Alert>
      ) : (
        <Table caption="Roles">
          <thead>
            <tr>
              <Th>Role</Th>
              <Th>Permissions</Th>
              <Th>Administrators</Th>
            </tr>
          </thead>
          <tbody>
            {res.data.length === 0 && <EmptyRow colSpan={3}>No roles yet.</EmptyRow>}
            {res.data.map((role) => (
              <Tr key={role.key}>
                <Td>
                  <Link href={`/admin/rbac/${role.key}`} className="font-medium hover:underline">
                    {role.name}
                  </Link>{' '}
                  {role.isSystem ? <Badge>Built-in</Badge> : <Badge tone="primary">Custom</Badge>}
                  {role.description && (
                    <p className="mt-1 max-w-md text-xs text-text-muted">{role.description}</p>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-text-secondary">
                  {plural(role.permissions.length, 'permission')}
                </Td>
                <Td className="whitespace-nowrap text-text-secondary">{role.userCount}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
