'use client';

import { Alert, Button } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';
import { useApiAction } from '@/lib/use-api-action';

export function TestCheckoutActions({
  reference,
  bookingId,
}: {
  reference: string;
  bookingId: string;
}) {
  const router = useRouter();
  const { pending, error, run } = useApiAction();
  const [choice, setChoice] = useState<'success' | 'failed' | null>(null);

  async function simulate(outcome: 'success' | 'failed') {
    setChoice(outcome);
    const done = await run(() =>
      api('POST', `/payments/test-checkout/${encodeURIComponent(reference)}`, { outcome }),
    );
    if (done)
      router.push(`/account/bookings/${bookingId}?reference=${encodeURIComponent(reference)}`);
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="error">{error.message}</Alert>}
      <Button
        onClick={() => simulate('success')}
        loading={pending && choice === 'success'}
        disabled={pending}
      >
        Simulate successful payment
      </Button>
      <Button
        variant="secondary"
        onClick={() => simulate('failed')}
        loading={pending && choice === 'failed'}
        disabled={pending}
      >
        Simulate declined payment
      </Button>
    </div>
  );
}
