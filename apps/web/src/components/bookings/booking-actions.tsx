'use client';

import { formatKobo, type PaymentInitView, type PaymentVerificationView } from '@havenhub/shared';
import { Alert, Button, Field, Textarea } from '@havenhub/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api/client';
import { useApiAction } from '@/lib/use-api-action';

/** Starts a payment attempt and hands the customer to the provider's checkout. */
export function PayButton({ bookingId, totalKobo }: { bookingId: string; totalKobo: number }) {
  const { pending, error, run } = useApiAction();
  const [leaving, setLeaving] = useState(false);

  async function pay() {
    const payment = await run(() =>
      api<PaymentInitView>('POST', `/bookings/${bookingId}/payments`),
    );
    if (payment) {
      setLeaving(true);
      window.location.assign(payment.authorizationUrl);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="error">{error.message}</Alert>}
      <Button onClick={pay} loading={pending || leaving} disabled={pending || leaving}>
        Pay {formatKobo(totalKobo)}
      </Button>
    </div>
  );
}

/**
 * Cancels through `endpoint` (customer, agent or admin route). The refund
 * amount shown is the API's figure; the API applies the policy again.
 */
export function CancelBooking({
  endpoint,
  refundKobo,
  paid,
  label = 'Cancel booking',
}: {
  endpoint: string;
  refundKobo: number;
  paid: boolean;
  label?: string;
}) {
  const router = useRouter();
  const { pending, error, run } = useApiAction();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');

  async function cancel() {
    const done = await run(() => api('POST', endpoint, { reason: reason.trim() || undefined }));
    if (done) {
      setConfirming(false);
      router.refresh();
    }
  }

  if (!confirming) {
    return (
      <Button variant="secondary" onClick={() => setConfirming(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="warning">
        {paid
          ? `The booking will be cancelled and a refund of ${formatKobo(refundKobo)} requested. HavenHub reviews refunds before the money is returned.`
          : 'The booking will be cancelled and its dates released. Nothing has been charged.'}
      </Alert>
      <Field label="Reason" optional>
        {(a) => (
          <Textarea
            {...a}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
      {error && <Alert tone="error">{error.message}</Alert>}
      <div className="flex flex-wrap gap-3">
        <Button variant="danger" onClick={cancel} loading={pending} disabled={pending}>
          Confirm cancellation
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
          Keep booking
        </Button>
      </div>
    </div>
  );
}

/**
 * The customer has come back from checkout with `?reference=`. The redirect
 * proves nothing: we ask the API to verify with the provider, then refresh.
 */
export function PaymentReturn({ reference }: { reference: string }) {
  const router = useRouter();
  const [result, setResult] = useState<PaymentVerificationView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void api<PaymentVerificationView>(
      'POST',
      `/payments/${encodeURIComponent(reference)}/verify`,
    ).then((res) => {
      if (res.success) {
        setResult(res.data);
        router.refresh();
      } else {
        setMessage(res.message);
      }
    });
  }, [reference, router]);

  if (message) return <Alert tone="warning">{message}</Alert>;
  if (!result) return <Alert>Confirming your payment with the payment provider…</Alert>;
  if (result.paymentStatus === 'SUCCESS' && result.bookingStatus === 'CONFIRMED') {
    return <Alert tone="success">Payment confirmed. Your booking is confirmed.</Alert>;
  }
  if (result.paymentStatus === 'SUCCESS') {
    return (
      <Alert tone="warning">
        We received your payment, but this booking could no longer be confirmed. A full refund has
        been requested automatically.
      </Alert>
    );
  }
  if (result.paymentStatus === 'FAILED') {
    return <Alert tone="error">The payment did not go through. You can try again below.</Alert>;
  }
  return (
    <Alert>
      Your payment has not been confirmed yet. If you completed it, this page will update once the
      payment provider confirms it.
    </Alert>
  );
}
