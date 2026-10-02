import { ENTITLEMENTS, type SubscriptionPlanView } from '@havenhub/shared';
import { Badge, Card, buttonClasses, cn } from '@havenhub/ui';
import { Check } from 'lucide-react';
import Link from 'next/link';

import { formatLimit, formatPlanPrice } from '@/lib/format';

/**
 * Plans side by side, straight from the database. On small screens each
 * plan is a card; from `lg` the same data is a comparison table.
 */
export function PlanComparison({
  plans,
  currentPlanId,
  actionFor,
}: {
  plans: SubscriptionPlanView[];
  currentPlanId: string;
  /** Href for choosing a plan, or null when it cannot be chosen. */
  actionFor: (plan: SubscriptionPlanView) => { href: string; label: string } | null;
}) {
  const rows = ENTITLEMENTS.filter((e) => plans.some((p) => p.entitlements[e.key] !== 0));
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2 lg:hidden">
        {plans.map((plan) => (
          <Card key={plan.id} className="flex flex-col gap-5 p-6">
            <PlanHeading plan={plan} current={plan.id === currentPlanId} />
            <dl className="flex flex-col gap-2 text-sm">
              {rows.map((e) => (
                <div key={e.key} className="flex justify-between gap-4">
                  <dt className="text-text-secondary">{e.label}</dt>
                  <dd className="font-medium text-text tabular-nums">
                    {formatLimit(plan.entitlements[e.key], e.unit)}
                  </dd>
                </div>
              ))}
            </dl>
            <Features plan={plan} />
            <PlanAction action={actionFor(plan)} current={plan.id === currentPlanId} />
          </Card>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-card border border-border bg-surface shadow-card lg:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Plan comparison</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="w-56 p-6 text-left align-bottom">
                <span className="sr-only">Allowance</span>
              </th>
              {plans.map((plan) => (
                <th key={plan.id} scope="col" className="p-6 text-left align-top font-normal">
                  <PlanHeading plan={plan} current={plan.id === currentPlanId} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.key} className="border-b border-border">
                <th scope="row" className="px-6 py-3.5 text-left font-medium text-text-secondary">
                  {e.label}
                  {!e.enforced && (
                    <span className="block text-xs text-text-muted">Coming soon</span>
                  )}
                </th>
                {plans.map((plan) => (
                  <td key={plan.id} className="px-6 py-3.5 text-text tabular-nums">
                    {formatLimit(plan.entitlements[e.key], e.unit)}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row" className="p-6 text-left">
                <span className="sr-only">Choose a plan</span>
              </th>
              {plans.map((plan) => (
                <td key={plan.id} className="p-6 align-top">
                  <Features plan={plan} />
                  <div className="mt-4">
                    <PlanAction action={actionFor(plan)} current={plan.id === currentPlanId} />
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function PlanHeading({ plan, current }: { plan: SubscriptionPlanView; current: boolean }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-text">{plan.name}</h2>
        {current && <Badge tone="primary">Current plan</Badge>}
      </div>
      <p className="mt-1 text-xl font-bold text-text tabular-nums">
        {plan.isDefault ? '₦0' : formatPlanPrice(plan.priceKobo, plan.billingInterval)}
      </p>
      {plan.description && <p className="mt-1 text-sm text-text-secondary">{plan.description}</p>}
    </div>
  );
}

function Features({ plan }: { plan: SubscriptionPlanView }) {
  if (plan.features.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5 text-sm text-text-secondary">
      {plan.features.map((f) => (
        <li key={f} className="flex gap-2">
          <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          {f}
        </li>
      ))}
    </ul>
  );
}

function PlanAction({
  action,
  current,
}: {
  action: { href: string; label: string } | null;
  current: boolean;
}) {
  if (!action) {
    return (
      <p className={cn('text-sm', current ? 'font-medium text-text' : 'text-text-muted')}>
        {current ? 'You are on this plan' : 'Included for every agent'}
      </p>
    );
  }
  return (
    <Link href={action.href} className={buttonClasses({ className: 'w-full whitespace-nowrap' })}>
      {action.label}
    </Link>
  );
}
