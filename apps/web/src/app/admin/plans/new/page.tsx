import { Card, CardBody } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { NoAccess } from '@/components/admin/no-access';
import { PlanForm } from '@/components/admin/subscriptions/plan-form';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'New plan' };

export default async function NewPlanPage() {
  const user = await requireUser('ADMIN', '/admin/plans/new');
  return (
    <>
      <Link href="/admin/plans" className="text-sm text-text-secondary hover:text-text">
        ← Plans
      </Link>
      <div className="mt-4">
        <PageHeader title="New plan" />
      </div>
      {hasPermission(user, 'subscriptions.plans') ? (
        <Card className="max-w-4xl">
          <CardBody>
            <PlanForm />
          </CardBody>
        </Card>
      ) : (
        <NoAccess />
      )}
    </>
  );
}
