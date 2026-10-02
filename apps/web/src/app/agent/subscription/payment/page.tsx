import { SUBSCRIPTION_REFERENCE } from '@havenhub/shared';
import { Alert, Card, CardBody } from '@havenhub/ui';
import type { Metadata } from 'next';

import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { PaymentResult } from '@/components/subscriptions/payment-result';

export const metadata: Metadata = { title: 'Payment' };

/** Return URL from the payment provider (it appends `?reference=`). */
export default async function SubscriptionPaymentPage({
  searchParams,
}: PageProps<'/agent/subscription/payment'>) {
  const sp = await searchParams;
  const reference = typeof sp.reference === 'string' ? sp.reference : '';
  return (
    <>
      <PageHeader title="Subscription payment" />
      <Card className="max-w-xl">
        <CardBody>
          {SUBSCRIPTION_REFERENCE.test(reference) ? (
            <PaymentResult reference={reference} />
          ) : (
            <Alert tone="error">This payment link is not valid.</Alert>
          )}
        </CardBody>
      </Card>
    </>
  );
}
