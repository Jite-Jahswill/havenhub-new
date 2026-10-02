import type { AdminSubscriptionPlanView } from '@havenhub/shared';
import { ENTITLEMENTS } from '@havenhub/shared';
import { Alert, Card, CardBody, CardHeader } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { NoAccess } from '@/components/admin/no-access';
import { PlanForm } from '@/components/admin/subscriptions/plan-form';
import { PlanStatusActions } from '@/components/admin/subscriptions/plan-status-actions';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { PlanStatusBadge } from '@/components/dashboard/status-badge';
import { serverApi } from '@/lib/api/server';
import { formatLimit, formatPlanPrice } from '@/lib/format';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Plan' };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function PlanPage({ params, searchParams }: PageProps<'/admin/plans/[id]'>) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser('ADMIN', `/admin/plans/${id}`);
  if (!UUID.test(id)) notFound();
  if (!hasPermission(user, 'subscriptions.view')) return <NoAccess />;
  const res = await serverApi<AdminSubscriptionPlanView>(`/admin/subscription-plans/${id}`);
  if (!res.success) {
    if (res.code === 'NOT_FOUND') notFound();
    return <Alert tone="error">{res.message}</Alert>;
  }
  const plan = res.data;
  const canEdit = hasPermission(user, 'subscriptions.plans') && plan.status !== 'ARCHIVED';

  return (
    <>
      <Link href="/admin/plans" className="text-sm text-text-secondary hover:text-text">
        ← Plans
      </Link>
      <div className="mt-4">
        <PageHeader
          title={plan.name}
          description={
            <span className="flex flex-wrap items-center gap-2">
              <PlanStatusBadge status={plan.status} />
              <span>{formatPlanPrice(plan.priceKobo, plan.billingInterval)}</span>
            </span>
          }
        />
      </div>
      {sp.created === '1' && (
        <Alert tone="success" className="mb-6">
          Plan created.
        </Alert>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader
            title={canEdit ? 'Edit plan' : 'Plan details'}
            description="Price changes apply to future purchases only; paid terms keep their price."
          />
          <CardBody>
            {canEdit ? (
              <PlanForm plan={plan} />
            ) : (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                {ENTITLEMENTS.map((e) => (
                  <div key={e.key} className="flex justify-between gap-4">
                    <dt className="text-text-secondary">{e.label}</dt>
                    <dd className="font-medium text-text">
                      {formatLimit(plan.entitlements[e.key], e.unit)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </CardBody>
        </Card>
        <aside className="flex flex-col gap-6">
          <Card>
            <CardBody className="flex flex-col gap-4 text-sm">
              <div className="flex justify-between">
                <span className="text-text-secondary">Active subscribers</span>
                <span className="font-semibold tabular-nums">{plan.activeSubscribers}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Terms ever sold</span>
                <span className="font-semibold tabular-nums">{plan.totalSubscriptions}</span>
              </div>
              <Link
                href={`/admin/subscriptions?planId=${plan.id}`}
                className="font-medium underline underline-offset-4"
              >
                View subscribers
              </Link>
            </CardBody>
          </Card>
          {hasPermission(user, 'subscriptions.plans') && (
            <Card>
              <CardHeader title="Availability" />
              <CardBody>
                <PlanStatusActions plan={plan} />
              </CardBody>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
