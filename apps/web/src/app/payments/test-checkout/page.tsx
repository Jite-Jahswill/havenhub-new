import { formatKobo, type TestCheckoutView } from '@havenhub/shared';
import { Alert, Card, Container } from '@havenhub/ui';
import { FlaskConical } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { TestCheckoutActions } from '@/components/bookings/test-checkout-actions';
import { serverApi } from '@/lib/api/server';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Test payment', robots: { index: false } };

/**
 * Development stand-in for the payment provider's checkout. The API refuses
 * it (404) unless PAYMENT_PROVIDER=test outside production.
 */
export default async function TestCheckoutPage({
  searchParams,
}: PageProps<'/payments/test-checkout'>) {
  const sp = await searchParams;
  const reference = typeof sp.reference === 'string' ? sp.reference : '';
  // The test provider has one checkout URL; agent subscription payments have their own page.
  if (reference.startsWith('HHS-')) {
    redirect(`/agent/subscription/test-checkout?reference=${encodeURIComponent(reference)}`);
  }
  await requireUser(
    'CUSTOMER',
    `/payments/test-checkout?reference=${encodeURIComponent(reference)}`,
  );
  const res = await serverApi<TestCheckoutView>(
    `/payments/test-checkout/${encodeURIComponent(reference)}`,
  );
  if (!res.success) notFound();
  const p = res.data;

  return (
    <Container className="max-w-lg py-12">
      <Card className="flex flex-col gap-6 p-6 sm:p-8">
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
          Real payments are not configured in this environment. Choose an outcome to simulate what
          the payment provider would report. HavenHub then verifies it on the server, exactly as it
          would a real payment.
        </Alert>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-text-muted">Booking</dt>
            <dd className="font-mono text-text">{p.bookingReference}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Amount</dt>
            <dd className="font-semibold text-text tabular-nums">{formatKobo(p.amountKobo)}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-text-muted">Stay</dt>
            <dd className="text-text">{p.propertyTitle}</dd>
          </div>
        </dl>
        {p.status === 'PENDING' ? (
          <TestCheckoutActions reference={p.reference} bookingId={p.bookingId} />
        ) : (
          <Alert>This payment has already been processed ({p.status.toLowerCase()}).</Alert>
        )}
      </Card>
    </Container>
  );
}
