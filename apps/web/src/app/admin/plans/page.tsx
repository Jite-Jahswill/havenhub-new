import type { AdminSubscriptionPlanView } from '@havenhub/shared';
import { Alert, buttonClasses } from '@havenhub/ui';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { NoAccess } from '@/components/admin/no-access';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { PlanStatusBadge } from '@/components/dashboard/status-badge';
import { serverApi } from '@/lib/api/server';
import { formatLimit, formatPlanPrice } from '@/lib/format';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Plans' };

export default async function AdminPlansPage() {
  const user = await requireUser('ADMIN', '/admin/plans');
  if (!hasPermission(user, 'subscriptions.view')) {
    return (
      <>
        <PageHeader title="Plans" />
        <NoAccess />
      </>
    );
  }
  const res = await serverApi<AdminSubscriptionPlanView[]>('/admin/subscription-plans');
  const canEdit = hasPermission(user, 'subscriptions.plans');
  return (
    <>
      <PageHeader
        title="Plans"
        description="Agent subscription plans, prices and limits. Agents see offered plans on their Plans page."
        action={
          canEdit && (
            <Link href="/admin/plans/new" className={buttonClasses()}>
              <Plus aria-hidden className="size-4" /> New plan
            </Link>
          )
        }
      />
      {!res.success ? (
        <Alert tone="error">{res.message}</Alert>
      ) : (
        <Table caption="Subscription plans">
          <thead>
            <tr>
              <Th>Plan</Th>
              <Th>Price</Th>
              <Th>Properties</Th>
              <Th>Photos / listing</Th>
              <Th>Featured</Th>
              <Th className="text-right">Subscribers</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {res.data.length === 0 && <EmptyRow colSpan={7}>No plans yet.</EmptyRow>}
            {res.data.map((p) => (
              <Tr key={p.id}>
                <Td>
                  <Link href={`/admin/plans/${p.id}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                  <span className="block text-xs text-text-muted">
                    {p.isDefault ? 'Free default' : `Rank ${p.rank}`} · {p.slug}
                  </span>
                </Td>
                <Td className="tabular-nums">{formatPlanPrice(p.priceKobo, p.billingInterval)}</Td>
                <Td className="tabular-nums">{formatLimit(p.entitlements.PROPERTY_COUNT)}</Td>
                <Td className="tabular-nums">{formatLimit(p.entitlements.IMAGES_PER_PROPERTY)}</Td>
                <Td className="tabular-nums">
                  {formatLimit(p.entitlements.FEATURED_PROPERTY_COUNT)}
                </Td>
                <Td className="text-right tabular-nums">{p.activeSubscribers}</Td>
                <Td>
                  <PlanStatusBadge status={p.status} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
