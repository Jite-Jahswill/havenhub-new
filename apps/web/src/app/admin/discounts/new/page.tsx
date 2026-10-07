import type { SubscriptionPlanView } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { DiscountCodeForm } from '@/components/admin/discounts/discount-code-form';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'New discount code' };

export default async function NewDiscountPage() {
  const user = await requireUser('ADMIN', '/admin/discounts/new');
  if (!hasPermission(user, 'discounts.manage')) return <NoAccess />;
  const plans = await serverApi<SubscriptionPlanView[]>('/subscriptions/plans');
  return (
    <>
      <Link href="/admin/discounts" className="text-sm text-text-secondary hover:text-text">
        ← Discounts
      </Link>
      <div className="mt-4">
        <PageHeader
          title="New discount code"
          description="A discount agents enter when they pay for a plan."
        />
      </div>
      <DiscountCodeForm plans={plans.success ? plans.data : []} />
    </>
  );
}
