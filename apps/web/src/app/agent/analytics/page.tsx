import type { AgentAnalytics } from '@havenhub/shared';
import { Alert } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { MetricCard, RangeForm, rangeQuery } from '@/components/admin/platform/analytics';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { firstIssue } from '@/lib/api/errors';
import { serverApi } from '@/lib/api/server';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Analytics' };

export default async function AgentAnalyticsPage({ searchParams }: PageProps<'/agent/analytics'>) {
  await requireUser('AGENT', '/agent/analytics');
  const res = await serverApi<AgentAnalytics>(
    `/agents/me/analytics?${rangeQuery(await searchParams)}`,
  );
  return (
    <>
      <PageHeader
        title="Analytics"
        description="How your listings performed. Only your own properties and bookings are counted."
      />
      {!res.success ? (
        <Alert tone="error">
          {firstIssue(res)}{' '}
          <Link href="/agent/analytics" className="font-medium underline">
            Show the last 30 days
          </Link>
        </Alert>
      ) : (
        <>
          <RangeForm range={res.data.range} action="/agent/analytics" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Property views" metric={res.data.propertyViews} />
            <MetricCard label="Bookings" metric={res.data.bookings} hint="Paid in the range" />
            <MetricCard
              label="Conversion"
              metric={res.data.conversion}
              format="percent"
              hint="Bookings ÷ property views"
            />
            <MetricCard
              label="Revenue"
              metric={res.data.revenueKobo}
              format="kobo"
              hint="Paid by guests, before refunds"
            />
            <MetricCard
              label="Earnings"
              metric={res.data.earningsKobo}
              format="kobo"
              hint="Your share of bookings paid in the range"
            />
            <MetricCard label="Reviews" metric={res.data.reviews} />
            <MetricCard label="Event sales" metric={res.data.eventSalesKobo} format="kobo" />
          </div>
        </>
      )}
    </>
  );
}
