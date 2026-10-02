import type { AgentSubscriptionView, SubscriptionPaymentView } from '@havenhub/shared';
import { formatKobo } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { PaymentStatusBadge, SubscriptionStatusBadge } from '@/components/dashboard/status-badge';
import { serverApiData } from '@/lib/api/server';
import { formatDate, formatMoment, formatPlanPrice } from '@/lib/format';
import { CHANGE_TYPE_LABELS, INTERVAL_LABELS } from '@/lib/labels';

export const metadata: Metadata = { title: 'Subscription history' };

export default async function SubscriptionHistoryPage() {
  const [terms, payments] = await Promise.all([
    serverApiData<AgentSubscriptionView[]>('/agents/me/subscription/history'),
    serverApiData<SubscriptionPaymentView[]>('/agents/me/subscription/payments'),
  ]);
  return (
    <>
      <Link href="/agent/subscription" className="text-sm text-text-secondary hover:text-text">
        ← Subscription
      </Link>
      <div className="mt-4">
        <PageHeader
          title="History"
          description="Every plan term and payment, kept for your records."
        />
      </div>
      <section aria-labelledby="terms-heading" className="flex flex-col gap-4">
        <h2 id="terms-heading" className="text-lg font-semibold text-text">
          Plan terms
        </h2>
        <Table caption="Plan terms">
          <thead>
            <tr>
              <Th>Plan</Th>
              <Th>Change</Th>
              <Th>Period</Th>
              <Th className="text-right">Price</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {(terms ?? []).length === 0 && (
              <EmptyRow colSpan={5}>You have always been on the free plan.</EmptyRow>
            )}
            {(terms ?? []).map((t) => (
              <Tr key={t.id}>
                <Td className="font-medium">{t.plan.name}</Td>
                <Td>{CHANGE_TYPE_LABELS[t.changeType]}</Td>
                <Td className="text-xs text-text-secondary">
                  {formatDate(t.currentPeriodStart)} – {formatDate(t.currentPeriodEnd)}
                  {t.endReason && <span className="block">{t.endReason}</span>}
                </Td>
                <Td className="text-right tabular-nums">
                  {formatPlanPrice(t.priceKobo, t.billingInterval)}
                </Td>
                <Td>
                  <SubscriptionStatusBadge status={t.status} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </section>
      <section aria-labelledby="payments-heading" className="mt-10 flex flex-col gap-4">
        <h2 id="payments-heading" className="text-lg font-semibold text-text">
          Payments
        </h2>
        <Table caption="Subscription payments">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Plan</Th>
              <Th className="text-right">Amount</Th>
              <Th>Status</Th>
              <Th>Reference</Th>
            </tr>
          </thead>
          <tbody>
            {(payments ?? []).length === 0 && <EmptyRow colSpan={5}>No payments yet.</EmptyRow>}
            {(payments ?? []).map((p) => (
              <Tr key={p.id}>
                <Td className="text-xs">{formatMoment(p.paidAt ?? p.createdAt)}</Td>
                <Td>
                  {p.planName}
                  <span className="block text-xs text-text-muted">
                    {INTERVAL_LABELS[p.billingInterval]}
                  </span>
                </Td>
                <Td className="text-right tabular-nums">
                  {formatKobo(p.amountKobo)}{' '}
                  <span className="text-xs text-text-muted">{p.currency}</span>
                </Td>
                <Td>
                  <PaymentStatusBadge status={p.status} />
                  {p.failureReason && (
                    <span className="block text-xs text-error">{p.failureReason}</span>
                  )}
                </Td>
                <Td className="font-mono text-xs break-all">{p.reference}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </section>
    </>
  );
}
