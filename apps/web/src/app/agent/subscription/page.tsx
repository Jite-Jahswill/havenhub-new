import type { CurrentSubscriptionView, SubscriptionPaymentView } from '@havenhub/shared';
import { formatKobo } from '@havenhub/shared';
import { Alert, Card, CardBody, CardHeader, buttonClasses } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { PaymentStatusBadge, SubscriptionStatusBadge } from '@/components/dashboard/status-badge';
import { SubscriptionActions } from '@/components/subscriptions/subscription-actions';
import { UsageMeters } from '@/components/subscriptions/usage-meters';
import { serverApi, serverApiData } from '@/lib/api/server';
import { formatDate, formatPlanPrice } from '@/lib/format';
import { CHANGE_TYPE_LABELS, INTERVAL_LABELS } from '@/lib/labels';

export const metadata: Metadata = { title: 'Subscription' };

export default async function AgentSubscriptionPage() {
  const [res, payments] = await Promise.all([
    serverApi<CurrentSubscriptionView>('/agents/me/subscription'),
    serverApiData<SubscriptionPaymentView[]>('/agents/me/subscription/payments'),
  ]);
  if (!res.success) {
    return (
      <>
        <PageHeader title="Subscription" />
        <Alert tone="error">{res.message}</Alert>
      </>
    );
  }
  const { plan, subscription: term, scheduled, usage, overLimit } = res.data;
  const recentPayments = (payments ?? []).slice(0, 5);

  return (
    <>
      <PageHeader
        title="Subscription"
        description="Your plan, what it includes and how much of it you use."
        action={
          <Link href="/agent/subscription/plans" className={buttonClasses()}>
            {plan.isDefault ? 'Upgrade' : 'Change plan'}
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px] [&>*]:min-w-0">
        <div className="flex flex-col gap-6">
          {overLimit.length > 0 && (
            <Alert tone="warning">
              You are using more than your {plan.name} plan allows. Nothing has been removed, but
              you cannot add more until you are within your limits or{' '}
              <Link href="/agent/subscription/plans" className="font-semibold underline">
                upgrade
              </Link>
              .
            </Alert>
          )}
          <Card>
            <CardHeader
              title={plan.name}
              description={plan.description ?? undefined}
              action={term ? <SubscriptionStatusBadge status={term.status} /> : undefined}
            />
            <CardBody className="flex flex-col gap-6">
              <dl className="grid gap-5 text-sm sm:grid-cols-3">
                <Detail label="Price">
                  {term
                    ? formatPlanPrice(term.priceKobo, term.billingInterval)
                    : formatPlanPrice(plan.priceKobo, plan.billingInterval)}
                </Detail>
                <Detail label="Billing">
                  {term ? INTERVAL_LABELS[term.billingInterval] : 'No billing — free plan'}
                </Detail>
                <Detail label={term?.cancelAtPeriodEnd ? 'Ends' : 'Current term'}>
                  {term
                    ? term.cancelAtPeriodEnd
                      ? formatDate(term.currentPeriodEnd)
                      : `${formatDate(term.currentPeriodStart)} – ${formatDate(term.currentPeriodEnd)}`
                    : 'Ongoing'}
                </Detail>
              </dl>
              {term && !term.cancelAtPeriodEnd && (
                <p className="text-sm text-text-secondary">
                  Plans do not renew automatically. To continue after{' '}
                  {formatDate(term.currentPeriodEnd)}, renew from{' '}
                  <Link href="/agent/subscription/plans" className="font-medium underline">
                    Plans
                  </Link>{' '}
                  — a renewal starts when this term ends, so you lose no time.
                </p>
              )}
              {term?.cancelAtPeriodEnd && (
                <Alert>
                  Cancelled — you keep {plan.name} until {formatDate(term.currentPeriodEnd)}, then
                  move to the free plan.
                </Alert>
              )}
              {scheduled && (
                <Alert>
                  {CHANGE_TYPE_LABELS[scheduled.changeType]} to{' '}
                  <strong>{scheduled.plan.name}</strong> is paid for and starts on{' '}
                  {formatDate(scheduled.currentPeriodStart)}.
                </Alert>
              )}
              {term && (
                <SubscriptionActions
                  cancelAtPeriodEnd={term.cancelAtPeriodEnd}
                  periodEnd={formatDate(term.currentPeriodEnd)}
                  planName={plan.name}
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Usage" description="Counted from your listings, as they are now." />
            <CardBody>
              <UsageMeters usage={usage} />
            </CardBody>
          </Card>
        </div>

        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title="Payment history"
              action={
                <Link href="/agent/subscription/history" className="text-sm font-medium underline">
                  View all
                </Link>
              }
            />
            <CardBody>
              {recentPayments.length === 0 ? (
                <p className="text-sm text-text-secondary">No subscription payments yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {recentPayments.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0 text-sm">
                        <p className="font-medium text-text">{p.planName}</p>
                        <p className="text-xs text-text-muted">{formatDate(p.createdAt)}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-sm font-semibold text-text tabular-nums">
                          {formatKobo(p.amountKobo)}
                        </span>
                        <PaymentStatusBadge status={p.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-text-muted">{label}</dt>
      <dd className="mt-1 font-medium text-text">{children}</dd>
    </div>
  );
}
