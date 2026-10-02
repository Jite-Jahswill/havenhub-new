import type { AdminSubscriptionDetail } from '@havenhub/shared';
import { formatKobo } from '@havenhub/shared';
import { Alert, Card, CardBody, CardHeader } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { NoAccess } from '@/components/admin/no-access';
import { SubscriptionAdminActions } from '@/components/admin/subscriptions/subscription-admin-actions';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { PaymentStatusBadge, SubscriptionStatusBadge } from '@/components/dashboard/status-badge';
import { serverApi } from '@/lib/api/server';
import { formatDate, formatMoment, formatPlanPrice } from '@/lib/format';
import { CHANGE_TYPE_LABELS } from '@/lib/labels';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Subscription' };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function AdminSubscriptionPage({
  params,
}: PageProps<'/admin/subscriptions/[id]'>) {
  const { id } = await params;
  const user = await requireUser('ADMIN', `/admin/subscriptions/${id}`);
  if (!UUID.test(id)) notFound();
  if (!hasPermission(user, 'subscriptions.view')) return <NoAccess />;
  const res = await serverApi<AdminSubscriptionDetail>(`/admin/subscriptions/${id}`);
  if (!res.success) {
    if (res.code === 'NOT_FOUND') notFound();
    return <Alert tone="error">{res.message}</Alert>;
  }
  const s = res.data;
  const rows: [string, React.ReactNode][] = [
    [
      'Agent',
      <>
        <Link href={`/admin/agents/${s.agent.id}`} className="hover:underline">
          {s.agent.displayName}
        </Link>
        <span className="block text-xs text-text-muted">{s.agent.email}</span>
      </>,
    ],
    ['Change', CHANGE_TYPE_LABELS[s.changeType]],
    ['Price', formatPlanPrice(s.priceKobo, s.billingInterval)],
    ['Period', `${formatDate(s.currentPeriodStart)} – ${formatDate(s.currentPeriodEnd)}`],
    ['Started', s.startedAt ? formatMoment(s.startedAt) : 'Not started'],
    [
      'Cancellation',
      s.cancelAtPeriodEnd ? 'At period end' : s.cancelledAt ? formatMoment(s.cancelledAt) : '—',
    ],
    [
      'Ended',
      s.endedAt ? `${formatMoment(s.endedAt)}${s.endReason ? ` — ${s.endReason}` : ''}` : '—',
    ],
  ];

  return (
    <>
      <Link href="/admin/subscriptions" className="text-sm text-text-secondary hover:text-text">
        ← Subscriptions
      </Link>
      <div className="mt-4">
        <PageHeader
          title={`${s.plan.name} — ${s.agent.displayName}`}
          description={<SubscriptionStatusBadge status={s.status} />}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] [&>*]:min-w-0">
        <div className="flex flex-col gap-6">
          <Card>
            <CardBody>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                {rows.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-text-muted">{label}</dt>
                    <dd className="mt-1 text-text">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
          <section aria-labelledby="payments-heading" className="flex flex-col gap-3">
            <h2 id="payments-heading" className="text-lg font-semibold text-text">
              Payments
            </h2>
            <Table caption="Payments for this subscription">
              <thead>
                <tr>
                  <Th>Reference</Th>
                  <Th>Paid</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {s.payments.length === 0 && <EmptyRow colSpan={4}>No payments linked.</EmptyRow>}
                {s.payments.map((p) => (
                  <Tr key={p.id}>
                    <Td className="font-mono text-xs break-all">
                      {p.reference}
                      <span className="block font-sans text-text-muted">
                        {p.provider === 'TEST' ? 'Test provider' : 'Paystack'}
                      </span>
                    </Td>
                    <Td className="text-xs">{p.paidAt ? formatMoment(p.paidAt) : '—'}</Td>
                    <Td className="text-right tabular-nums">{formatKobo(p.amountKobo)}</Td>
                    <Td>
                      <PaymentStatusBadge status={p.status} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </section>
        </div>
        <aside>
          <Card>
            <CardHeader title="Actions" />
            <CardBody>
              {hasPermission(user, 'subscriptions.manage') ? (
                <SubscriptionAdminActions subscription={s} />
              ) : (
                <p className="text-sm text-text-secondary">
                  Managing subscriptions requires the “subscriptions.manage” permission.
                </p>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}
