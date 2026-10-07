'use client';

import type { SubscriptionCheckoutView } from '@havenhub/shared';
import { Button } from '@havenhub/ui';

import { api } from '@/lib/api/client';
import { useApiAction } from '@/lib/use-api-action';
import { ApiErrorAlert } from './upgrade-prompt';

/** Starts a server-priced checkout and hands over to the payment provider. */
export function CheckoutButton({
  planId,
  code,
  label,
}: {
  planId: string;
  /** A discount code already validated by the quote; the server checks it again. */
  code?: string;
  label: string;
}) {
  const { pending, error, run } = useApiAction();

  async function pay() {
    const checkout = await run(() =>
      api<SubscriptionCheckoutView>('POST', '/agents/me/subscription/checkout', {
        planId,
        ...(code ? { code } : {}),
      }),
    );
    if (checkout) window.location.assign(checkout.authorizationUrl);
  }

  return (
    <div className="flex flex-col gap-3">
      <ApiErrorAlert error={error} />
      <Button size="lg" onClick={pay} loading={pending} className="w-full sm:w-auto">
        {label}
      </Button>
    </div>
  );
}
