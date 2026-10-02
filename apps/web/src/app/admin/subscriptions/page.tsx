import type {
  AdminSubscriptionListItem,
  AdminSubscriptionPlanView,
  Paginated,
  SubscriptionStatsView,
} from '@havenhub/shared';
import { formatKobo } from '@havenhub/shared';
import { Alert, Card, CardBody, CardHeader } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Filters } from '@/components/admin/filters';
import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { Stat } from '@/components/dashboard/stat';
import { SubscriptionStatusBadge } from '@/components/dashboard/status-badge';
import { serverApi, serverApiData } from '@/lib/api/server';
import { formatDate, formatPlanPrice, plural } from '@/lib/format';
import { CHANGE_TYPE_LABELS, SUBSCRIPTION_STATUS_LABELS } from '@/lib/labels';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Subscriptions' };

const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);

export default async function AdminSubscriptionsPage({
  searchParams,
}: PageProps<'/admin/subscriptions'>) {
  const user = await requireUser('ADMIN', '/admin/subscriptions');
  if (!hasPermission(user, 'subscriptions.view')) {
    return (
      <>
        <PageHeader title="Subscriptions" />
        <NoAccess />
      </>
    );
  }
  const sp = await searchParams;
  const params = {
    search: str(sp.search),
    status: str(sp.status),
    planId: str(sp.planId),
    page: str(sp.page),
  };
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const [list, stats, plans] = await Promise.all([
    serverApi<Paginated<AdminSubscriptionListItem>>(`/admin/subscriptions?${query}`),
    serverApiData<SubscriptionStatsView>('/admin/subscriptions/stats'),
    serverApiData<AdminSubscriptionPlanView[]>('/admin/subscription-plans'),
  ]);

  return (
    <>
      <PageHeader
        title="Subscriptions"
        description="Agent plan terms, from verified payments. Every figure is counted from stored records."
      />
      {stats && (
        <div className="mb-8 flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Agents on paid plans"
              value={stats.paidAgents}
              hint={`${stats.freeAgents} on the free plan`}
            />
            <Stat
              label="Subscription revenue"
              value={formatKobo(stats.revenueKobo)}
              hint="All verified payments"
            />
            <Stat label="Revenue, last 30 days" value={formatKobo(stats.revenueLast30DaysKobo)} />
            <Stat
              label="Changes, last 30 days"
              value={
                stats.last30Days.new +
                stats.last30Days.upgrades +
                stats.last30Days.downgrades +
                stats.last30Days.renewals
              }
              hint={`${stats.last30Days.new} new · ${stats.last30Days.upgrades} upgrades · ${stats.last30Days.downgrades} downgrades · ${stats.last30Days.renewals} renewals`}
            />
          </div>
          <Card>
            <CardHeader title="By plan" />
            <CardBody>
              <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {stats.byPlan.map((p) => (
                  <div key={p.planId} className="flex justify-between gap-4">
                    <dt className="text-text-secondary">{p.name}</dt>
                    <dd className="text-text tabular-nums">
                      {p.isDefault
                        ? plural(p.activeSubscribers, 'agent')
                        : `${p.activeSubscribers} active`}
                      {!p.isDefault && (
                        <span className="text-text-muted"> · {formatKobo(p.revenueKobo)}</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-xs text-text-muted">
                Terms by status:{' '}
                {Object.entries(stats.byStatus)
                  .map(
                    ([s, n]) =>
                      `${SUBSCRIPTION_STATUS_LABELS[s as keyof typeof stats.byStatus]} ${n}`,
                  )
                  .join(' · ')}
              </p>
            </CardBody>
          </Card>
        </div>
      )}

      <Filters
        search={params.search}
        placeholder="Search by agent, business or email"
        select={{
          name: 'status',
          label: 'Status',
          value: params.status,
          options: Object.entries(SUBSCRIPTION_STATUS_LABELS),
        }}
        selects={[
          {
            name: 'planId',
            label: 'Plan',
            value: params.planId,
            options: (plans ?? []).filter((p) => !p.isDefault).map((p) => [p.id, p.name]),
          },
        ]}
      />
      {!list.success ? (
        <Alert tone="error">{list.message}</Alert>
      ) : (
        <>
          <Table caption="Agent subscriptions">
            <thead>
              <tr>
                <Th>Agent</Th>
                <Th>Plan</Th>
                <Th>Period</Th>
                <Th className="text-right">Price</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.length === 0 && <EmptyRow colSpan={5}>No subscriptions.</EmptyRow>}
              {list.data.items.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <Link
                      href={`/admin/subscriptions/${s.id}`}
                      className="font-medium hover:underline"
                    >
                      {s.agent.displayName}
                    </Link>
                    <span className="block text-xs text-text-muted">{s.agent.email}</span>
                  </Td>
                  <Td>
                    {s.plan.name}
                    <span className="block text-xs text-text-muted">
                      {CHANGE_TYPE_LABELS[s.changeType]}
                    </span>
                  </Td>
                  <Td className="text-xs text-text-secondary">
                    {formatDate(s.currentPeriodStart)} – {formatDate(s.currentPeriodEnd)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatPlanPrice(s.priceKobo, s.billingInterval)}
                  </Td>
                  <Td>
                    <SubscriptionStatusBadge status={s.status} />
                    {s.cancelAtPeriodEnd && (
                      <span className="block text-xs text-text-muted">Ends at period end</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={list.data} basePath="/admin/subscriptions" params={params} />
        </>
      )}
    </>
  );
}
