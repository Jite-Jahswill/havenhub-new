import type { Metadata } from 'next';
import Link from 'next/link';

import { NoAccess } from '@/components/admin/no-access';
import { RoleForm } from '@/components/admin/platform/role-form';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'New role' };

export default async function NewRolePage() {
  const user = await requireUser('ADMIN', '/admin/rbac/new');
  return (
    <>
      <Link href="/admin/rbac" className="text-sm text-text-secondary hover:text-text">
        ← Roles
      </Link>
      <div className="mt-4">
        <PageHeader title="New role" />
      </div>
      {hasPermission(user, 'roles.manage') ? <RoleForm held={user.permissions} /> : <NoAccess />}
    </>
  );
}
