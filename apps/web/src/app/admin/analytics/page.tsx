import type { FinancialAnalytics, PlatformAnalytics } from '@havenhub/shared';
import { MODERATED_LISTING_LABELS, MODERATED_LISTING_TYPES } from '@havenhub/shared';
import { Alert } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { NoAccess } from '@/components/admin/no-access';
import { MetricCard, RangeForm, rangeQuery } from '@/components/admin/platform/analytics';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { firstIssue } from '@/lib/api/errors';
import { serverApi } from '@/lib/api/server';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Analytics' };

const GRID = 'grid gap-4 sm:grid-cols-2 xl:grid-cols-4';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10" aria-labelledby={`h-${title}`}>
      <h2 id={`h-${title}`} className="mb-4 text-lg font-semibold text-text">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function AdminAnalyticsPage({ searchParams }: PageProps<'/admin/analytics'>) {
  const user = await requireUser('ADMIN', '/admin/analytics');
  const canView = hasPermission(user, 'analytics.view');
  const canFinance = hasPermission(user, 'analytics.financial');
  if (!canView && !canFinance) {
    return (
      <>
        <PageHeader title="Analytics" />
        <NoAccess />
      </>
    );
  }
  const query = rangeQuery(await searchParams);
  const [overview, financial] = await Promise.all([
    canView ? serverApi<PlatformAnalytics>(`/admin/analytics/overview?${query}`) : null,
    canFinance ? serverApi<FinancialAnalytics>(`/admin/analytics/financial?${query}`) : null,
  ]);
  const failed = [overview, financial].find((r) => r && !r.success);
  const range =
    (overview?.success && overview.data.range) || (financial?.success && financial.data.range);

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Live figures from bookings, payments and accounts. Money is gross unless stated."
      />
      {failed && !failed.success && (
        <Alert tone="error" className="mb-6">
          {firstIssue(failed)}{' '}
          <Link href="/admin/analytics" className="font-medium underline">
            Show the last 30 days
          </Link>
        </Alert>
      )}
      {range && <RangeForm range={range} action="/admin/analytics" />}

      {overview?.success && (
        <>
          <Section title="People">
            <div className={GRID}>
              <MetricCard
                label="Total users"
                metric={overview.data.users.total}
                hint="At the end of the range"
              />
              <MetricCard
                label="New users"
                metric={overview.data.users.new}
                hint="Signed up in the range"
              />
              <MetricCard
                label="Active users"
                metric={overview.data.users.active}
                hint="Approximate: sessions signed in before the range ended and last used after it began"
              />
              <MetricCard label="Agents" metric={overview.data.agents.total} />
              <MetricCard
                label="Verified agents"
                metric={overview.data.agents.verified}
                hint="Currently verified"
              />
            </div>
          </Section>
          <Section title="Listings and bookings">
            <div className={GRID}>
              {MODERATED_LISTING_TYPES.map((type) => (
                <MetricCard
                  key={type}
                  label={`Live ${MODERATED_LISTING_LABELS[type].toLowerCase()}`}
                  metric={overview.data.listings[type]}
                  hint="Published right now"
                />
              ))}
              <MetricCard
                label="Confirmed bookings"
                metric={overview.data.bookings.confirmed}
                hint="Paid in the range"
              />
              <MetricCard label="Property sales" metric={overview.data.sales} />
              <MetricCard label="Event tickets sold" metric={overview.data.eventTicketSales} />
              <MetricCard label="Reviews" metric={overview.data.reviews} />
            </div>
          </Section>
        </>
      )}

      {financial?.success && (
        <Section title="Money">
          <div className={GRID}>
            <MetricCard
              label="Revenue"
              metric={financial.data.revenueKobo}
              format="kobo"
              hint="Successful booking payments, before refunds"
            />
            <MetricCard label="Successful payments" metric={financial.data.successfulPayments} />
            <MetricCard
              label="Refunds"
              metric={financial.data.refundsKobo}
              format="kobo"
              hint="Completed in the range"
            />
            <MetricCard label="Refund count" metric={financial.data.refunds} />
            <MetricCard
              label="Platform commission"
              metric={financial.data.commissionKobo}
              format="kobo"
            />
            <MetricCard label="Service fees" metric={financial.data.serviceFeeKobo} format="kobo" />
            <MetricCard label="VAT collected" metric={financial.data.vatKobo} format="kobo" />
            <MetricCard
              label="Subscription revenue"
              metric={financial.data.subscriptionRevenueKobo}
              format="kobo"
            />
            <MetricCard label="Withdrawals" metric={financial.data.withdrawalsKobo} format="kobo" />
            <MetricCard
              label="Ticket revenue"
              metric={financial.data.eventTicketSalesKobo}
              format="kobo"
            />
          </div>
        </Section>
      )}
      {!canFinance && (
        <p className="text-sm text-text-muted">
          Financial figures need the “View financial analytics” permission.
        </p>
      )}
    </>
  );
}
