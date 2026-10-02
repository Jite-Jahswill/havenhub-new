'use client';

import type { SubscriptionPaymentVerificationView } from '@havenhub/shared';
import { Alert, Button, Spinner, buttonClasses } from '@havenhub/ui';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api/client';
import { formatDate } from '@/lib/format';
import { useApiAction } from '@/lib/use-api-action';

/**
 * The agent is back from checkout. The page shows only what the server
 * verified with the provider — never what the redirect claims.
 */
export function PaymentResult({ reference }: { reference: string }) {
  const { error, run } = useApiAction();
  const [result, setResult] = useState<SubscriptionPaymentVerificationView | null>(null);
  const [checking, setChecking] = useState(true);

  const request = useCallback(
    () =>
      run(() =>
        api<SubscriptionPaymentVerificationView>(
          'POST',
          `/agents/me/subscription/payments/${encodeURIComponent(reference)}/verify`,
        ),
      ),
    [reference, run],
  );

  useEffect(() => {
    let active = true;
    void request().then((data) => {
      if (!active) return;
      if (data) setResult(data);
      setChecking(false);
    });
    return () => {
      active = false;
    };
  }, [request]);

  async function verify() {
    setChecking(true);
    const data = await request();
    if (data) setResult(data);
    setChecking(false);
  }

  if (checking && !result) {
    return (
      <p role="status" className="flex items-center gap-3 text-text-secondary">
        <Spinner /> Confirming your payment with the payment provider…
      </p>
    );
  }
  if (error && !result) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="error">{error.message}</Alert>
        <Button variant="secondary" onClick={verify} className="self-start">
          Check again
        </Button>
      </div>
    );
  }
  if (!result) return null;

  const back = (
    <Link href="/agent/subscription" className={buttonClasses({ className: 'self-start' })}>
      Go to my subscription
    </Link>
  );
  if (result.paymentStatus === 'SUCCESS' && result.subscription) {
    const s = result.subscription;
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success">
          {s.status === 'ACTIVE'
            ? `Payment confirmed. Your ${s.plan.name} plan is active until ${formatDate(s.currentPeriodEnd)}.`
            : `Payment confirmed. Your ${s.plan.name} plan starts on ${formatDate(s.currentPeriodStart)}.`}
        </Alert>
        {back}
      </div>
    );
  }
  if (result.paymentStatus === 'FAILED') {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="error">
          The payment did not go through, and your plan has not changed. You can try again.
        </Alert>
        <Link
          href="/agent/subscription/plans"
          className={buttonClasses({ className: 'self-start' })}
        >
          Choose a plan
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="warning">
        The payment is not complete yet. If you finished paying, it can take a moment to confirm.
      </Alert>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={verify} loading={checking}>
          Check again
        </Button>
        {back}
      </div>
    </div>
  );
}
