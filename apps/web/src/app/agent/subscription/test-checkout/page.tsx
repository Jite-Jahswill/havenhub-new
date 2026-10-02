import { formatKobo, type SubscriptionTestCheckoutView } from '@havenhub/shared';
import { Alert, Card } from '@havenhub/ui';
import { FlaskConical } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { SubscriptionTestCheckoutActions } from '@/components/subscriptions/test-checkout-actions';
import { serverApi } from '@/lib/api/server';
import { INTERVAL_LABELS } from '@/lib/labels';

export const metadata: Metadata = { title: 'Test payment', robots: { index: false } };

/** Development stand-in for the provider's checkout (404 unless PAYMENT_PROVIDER=test). */
export default async function SubscriptionTestCheckoutPage({
  searchParams,
}: PageProps<'/agent/subscription/test-checkout'>) {
  const sp = await searchParams;
  const reference = typeof sp.reference === 'string' ? sp.reference : '';
  const res = await serverApi<SubscriptionTestCheckoutView>(
    `/agents/me/subscription/test-checkout/${encodeURIComponent(reference)}`,
  );
  if (!res.success) notFound();
  const p = res.data;
  return (
    <Card className="mx-auto flex max-w-lg flex-col gap-6 p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-warning-subtle text-warning">
          <FlaskConical aria-hidden className="size-5" />
        </span>
        <div>
          <h1 className="text-xl font-bold text-text">Test payment</h1>
          <p className="text-sm text-text-secondary">Development mode — no real money moves.</p>
        </div>
      </div>
      <Alert tone="warning">
        Real payments are not configured in this environment. Choose what the payment provider would
        report; HavenHub then verifies it on the server exactly as it would a real payment.
      </Alert>
      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-text-muted">Plan</dt>
          <dd className="text-text">
            {p.planName} · {INTERVAL_LABELS[p.billingInterval]}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">Amount</dt>
          <dd className="font-semibold text-text tabular-nums">{formatKobo(p.amountKobo)}</dd>
        </div>
      </dl>
      {p.status === 'PENDING' ? (
        <SubscriptionTestCheckoutActions reference={p.reference} />
      ) : (
        <Alert>This payment has already been processed ({p.status.toLowerCase()}).</Alert>
      )}
    </Card>
  );
}
