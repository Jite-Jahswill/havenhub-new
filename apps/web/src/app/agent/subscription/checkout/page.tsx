import type { SubscriptionQuoteView } from '@havenhub/shared';
import { ENTITLEMENTS, formatKobo } from '@havenhub/shared';
import { Alert, Button, Card, CardBody, CardHeader, Input } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { CheckoutButton } from '@/components/subscriptions/checkout-button';
import { serverApi } from '@/lib/api/server';
import { formatLimit, formatDate, formatPlanPrice } from '@/lib/format';
import { CHANGE_TYPE_LABELS } from '@/lib/labels';

export const metadata: Metadata = { title: 'Confirm plan' };

const UUID = /^[0-9a-f-]{36}$/i;
const CODE = /^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/;

export default async function SubscriptionCheckoutPage({
  searchParams,
}: PageProps<'/agent/subscription/checkout'>) {
  const sp = await searchParams;
  const planId = typeof sp.plan === 'string' && UUID.test(sp.plan) ? sp.plan : null;
  const code = typeof sp.code === 'string' && CODE.test(sp.code.trim()) ? sp.code.trim() : null;
  const quoteFor = (withCode: string | null) =>
    serverApi<SubscriptionQuoteView>(
      `/agents/me/subscription/quote?planId=${planId}${withCode ? `&code=${encodeURIComponent(withCode)}` : ''}`,
    );
  let res = planId ? await quoteFor(code) : null;
  // A code that does not apply: show why, and the price without it.
  let codeError: string | null = null;
  if (planId && code && res && !res.success && res.code === 'DISCOUNT_CODE_INVALID') {
    codeError = res.message;
    res = await quoteFor(null);
  }
  if (typeof sp.code === 'string' && sp.code.trim() && !code) {
    codeError = 'Use 3–32 letters, numbers or dashes';
  }

  return (
    <>
      <Link
        href="/agent/subscription/plans"
        className="text-sm text-text-secondary hover:text-text"
      >
        ← Plans
      </Link>
      <div className="mt-4">
        <PageHeader title="Confirm your plan" />
      </div>
      {!res || !res.success ? (
        <Alert tone="error">{res && !res.success ? res.message : 'Choose a plan first.'}</Alert>
      ) : (
        <Quote quote={res.data} codeError={codeError} enteredCode={code ?? ''} />
      )}
    </>
  );
}

function Quote({
  quote,
  codeError,
  enteredCode,
}: {
  quote: SubscriptionQuoteView;
  codeError: string | null;
  enteredCode: string;
}) {
  const { plan } = quote;
  return (
    <div className="grid max-w-4xl gap-6 lg:grid-cols-[1fr_320px] [&>*]:min-w-0">
      <Card>
        <CardHeader
          title={`${CHANGE_TYPE_LABELS[quote.changeType]}: ${plan.name}`}
          description={formatPlanPrice(plan.priceKobo, plan.billingInterval)}
        />
        <CardBody className="flex flex-col gap-5">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-text-muted">Starts</dt>
              <dd className="mt-1 font-medium text-text">
                {quote.startsImmediately
                  ? 'As soon as payment is confirmed'
                  : formatDate(quote.startsAt)}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">Term ends</dt>
              <dd className="mt-1 font-medium text-text">{formatDate(quote.endsAt)}</dd>
            </div>
          </dl>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-text-secondary">
            {quote.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          {quote.overLimit.length > 0 && (
            <Alert tone="warning">
              <p className="font-semibold">You currently use more than {plan.name} allows:</p>
              <ul className="mt-1 list-disc pl-5">
                {quote.overLimit.map((o) => (
                  <li key={o.key}>
                    {o.label}: {o.used} used, {plan.name} allows {o.limit}
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                Nothing will be deleted or hidden. Once {plan.name} applies you will not be able to
                add more until you are within its limits.
              </p>
            </Alert>
          )}
          <h3 className="text-sm font-semibold text-text">Included</h3>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {ENTITLEMENTS.filter((e) => e.enforced).map((e) => (
              <div key={e.key} className="flex justify-between gap-4">
                <dt className="text-text-secondary">{e.label}</dt>
                <dd className="font-medium text-text tabular-nums">
                  {formatLimit(plan.entitlements[e.key], e.unit)}
                </dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>
      <Card className="self-start">
        <CardBody className="flex flex-col gap-4">
          {quote.discount && (
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-text-secondary">{plan.name}</dt>
                <dd className="tabular-nums">{formatKobo(quote.listPriceKobo)}</dd>
              </div>
              <div className="flex justify-between text-success">
                <dt>
                  {quote.discount.code} ({quote.discount.label})
                </dt>
                <dd className="tabular-nums">−{formatKobo(quote.discount.amountOffKobo)}</dd>
              </div>
            </dl>
          )}
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-text-secondary">Total due now</span>
            <span className="text-2xl font-bold text-text tabular-nums">
              {formatKobo(quote.amountKobo)}
            </span>
          </div>
          <form method="get" className="flex flex-col gap-2">
            <input type="hidden" name="plan" value={plan.id} />
            <label htmlFor="discount-code" className="text-sm font-medium text-text">
              Discount code
            </label>
            <div className="flex gap-2">
              <Input
                id="discount-code"
                name="code"
                defaultValue={quote.discount?.code ?? enteredCode}
                autoComplete="off"
                maxLength={32}
                aria-invalid={codeError ? true : undefined}
                aria-describedby={codeError ? 'discount-code-error' : undefined}
                className="uppercase"
              />
              <Button type="submit" variant="secondary">
                Apply
              </Button>
            </div>
            {codeError && (
              <p id="discount-code-error" className="text-sm text-error">
                {codeError}
              </p>
            )}
            {quote.discount && (
              <Link
                href={`/agent/subscription/checkout?plan=${plan.id}`}
                className="text-xs text-text-secondary underline"
              >
                Remove code
              </Link>
            )}
          </form>
          <CheckoutButton
            planId={plan.id}
            code={quote.discount?.code}
            label={`Pay ${formatKobo(quote.amountKobo)}`}
          />
          <p className="text-xs text-text-muted">
            You pay on the payment provider&apos;s secure page. Your plan changes only after
            HavenHub confirms the payment with the provider.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
