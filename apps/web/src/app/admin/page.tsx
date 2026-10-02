import type { AdminOverview } from '@havenhub/shared';
import { Card, CardBody, CardHeader, buttonClasses } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { Stat } from '@/components/dashboard/stat';
import { VerificationBadge } from '@/components/dashboard/status-badge';
import { serverApiData } from '@/lib/api/server';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Admin dashboard' };

const roleName = (key: string) =>
  key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export default async function AdminDashboardPage() {
  const user = await requireUser('ADMIN', '/admin');
  const overview = hasPermission(user, 'users.view')
    ? await serverApiData<AdminOverview>('/admin/overview')
    : null;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Signed in as ${user.roles.map(roleName).join(', ') || 'an administrator without roles'}.`}
      />
      {!overview ? (
        <NoAccess />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Total users" value={overview.users.total} />
            <Stat label="Customers" value={overview.users.customers} />
            <Stat label="Agents" value={overview.users.agents} />
            <Stat label="Administrators" value={overview.users.admins} />
          </div>
          <Card>
            <CardHeader
              title="Agent verification"
              description={`${overview.agentsByVerificationStatus.UNDER_REVIEW} awaiting review`}
              action={
                hasPermission(user, 'agents.view') && (
                  <Link
                    href="/admin/agents?verificationStatus=UNDER_REVIEW"
                    className={buttonClasses({ size: 'sm', variant: 'secondary' })}
                  >
                    Review queue
                  </Link>
                )
              }
            />
            <CardBody>
              <ul className="grid gap-3 sm:grid-cols-3">
                {Object.entries(overview.agentsByVerificationStatus).map(([status, count]) => (
                  <li
                    key={status}
                    className="flex items-center justify-between rounded-control bg-surface-secondary px-4 py-3"
                  >
                    <VerificationBadge
                      status={status as keyof typeof overview.agentsByVerificationStatus}
                    />
                    <span className="font-semibold text-text tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
