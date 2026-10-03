import { PERMISSIONS, type RoleDetail } from '@havenhub/shared';
import { Badge, Card, CardBody, CardHeader } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { NoAccess } from '@/components/admin/no-access';
import { DeleteRole, RoleForm } from '@/components/admin/platform/role-form';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Role' };

export default async function RolePage({ params }: PageProps<'/admin/rbac/[key]'>) {
  const user = await requireUser('ADMIN', '/admin/rbac');
  const { key } = await params;
  if (!/^[a-z][a-z0-9_]{1,59}$/.test(key)) notFound();
  const res = await serverApi<RoleDetail>(`/admin/rbac/roles/${key}`);
  if (!res.success) {
    if (res.code === 'NOT_FOUND') notFound();
    return <NoAccess />;
  }
  const role = res.data;
  const holds = role.users.some((u) => u.id === user.id);

  const holders = (
    <Card>
      <CardHeader title={`Administrators (${role.userCount})`} />
      <CardBody>
        {role.users.length === 0 ? (
          <p className="text-sm text-text-secondary">Nobody holds this role.</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {role.users.map((u) => (
              <li key={u.id}>
                <p className="font-medium text-text">{u.fullName}</p>
                <p className="text-xs break-all text-text-muted">{u.email}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-text-muted">
          Assign or remove roles from the{' '}
          <Link href="/admin/users?accountType=ADMIN" className="underline">
            Users
          </Link>{' '}
          page.
        </p>
      </CardBody>
    </Card>
  );

  return (
    <>
      <Link href="/admin/rbac" className="text-sm text-text-secondary hover:text-text">
        ← Roles
      </Link>
      <div className="mt-4">
        <PageHeader
          title={role.name}
          description={role.description ?? undefined}
          action={role.isSystem ? <Badge>Built-in</Badge> : <Badge tone="primary">Custom</Badge>}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {role.isSystem || holds ? (
            <Card>
              <CardHeader
                title="Permissions"
                description={
                  role.isSystem
                    ? 'Built-in roles are defined by HavenHub and cannot be changed.'
                    : 'You hold this role, so you cannot change it.'
                }
              />
              <CardBody>
                <ul className="flex flex-col gap-2 text-sm">
                  {role.permissions.map((p) => (
                    <li key={p}>
                      {PERMISSIONS[p]}
                      <span className="block font-mono text-xs text-text-muted">{p}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : (
            <RoleForm role={role} held={user.permissions} />
          )}
        </div>
        <div className="flex flex-col gap-6">
          {holders}
          {!role.isSystem && !holds && <DeleteRole roleKey={role.key} name={role.name} />}
        </div>
      </div>
    </>
  );
}
