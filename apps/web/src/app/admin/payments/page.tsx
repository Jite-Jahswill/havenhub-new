import type {
  AdminPaymentListItem,
  AdminRefundListItem,
  Paginated,
  PricingConfigView,
} from '@havenhub/shared';
import { formatKobo } from '@havenhub/shared';
import { Alert, Card, CardBody, CardHeader } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Filters } from '@/components/admin/filters';
import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PricingConfigForm } from '@/components/bookings/pricing-config-form';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { PaymentStatusBadge, RefundStatusBadge } from '@/components/dashboard/status-badge';
import { serverApi } from '@/lib/api/server';
import { formatMoment, formatRate } from '@/lib/format';
import { PAYMENT_STATUS_LABELS, REFUND_STATUS_LABELS } from '@/lib/labels';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Payments' };

const TABS = [
  ['payments', 'Payments'],
  ['refunds', 'Refunds'],
  ['rates', 'Commission & VAT'],
] as const;
type Tab = (typeof TABS)[number][0];
const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);

export default async function AdminPaymentsPage({ searchParams }: PageProps<'/admin/payments'>) {
  const user = await requireUser('ADMIN', '/admin/payments');
  const sp = await searchParams;
  const tab: Tab = TABS.some(([t]) => t === sp.tab) ? (sp.tab as Tab) : 'payments';
  const params = { tab, status: str(sp.status), page: str(sp.page) };
  const query = new URLSearchParams(
    Object.entries({ status: params.status, page: params.page }).filter(
      (e): e is [string, string] => Boolean(e[1]),
    ),
  );

  return (
    <>
      <PageHeader
        title="Payments"
        description="Payments, refunds and the rates applied to new bookings."
      />
      {!hasPermission(user, 'payments.view') ? (
        <NoAccess />
      ) : (
        <>
          <nav aria-label="Finance sections" className="mb-6 flex flex-wrap gap-2 text-sm">
            {TABS.map(([key, label]) => (
              <Link
                key={key}
                href={`/admin/payments?tab=${key}`}
                aria-current={tab === key ? 'page' : undefined}
                className="rounded-full border border-border px-3.5 py-1.5 font-medium text-text hover:bg-surface-secondary aria-[current=page]:bg-surface-inverse aria-[current=page]:text-text-inverse"
              >
                {label}
              </Link>
            ))}
          </nav>
          {tab === 'payments' && <PaymentsTab query={query} params={params} />}
          {tab === 'refunds' && <RefundsTab query={query} params={params} />}
          {tab === 'rates' && <RatesTab canEdit={hasPermission(user, 'payments.settings')} />}
        </>
      )}
    </>
  );
}

type Params = { tab: Tab; status: string | undefined; page: string | undefined };

async function PaymentsTab({ query, params }: { query: URLSearchParams; params: Params }) {
  const res = await serverApi<Paginated<AdminPaymentListItem>>(`/admin/payments?${query}`);
  if (!res.success) return <Alert tone="error">{res.message}</Alert>;
  return (
    <>
      <Filters
        searchable={false}
        hidden={{ tab: 'payments' }}
        select={{
          name: 'status',
          label: 'Status',
          value: params.status,
          options: Object.entries(PAYMENT_STATUS_LABELS),
        }}
      />
      <Table caption="Payments">
        <thead>
          <tr>
            <Th>Payment</Th>
            <Th>Customer</Th>
            <Th>When</Th>
            <Th className="text-right">Amount</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {res.data.items.length === 0 && <EmptyRow colSpan={5}>No payments.</EmptyRow>}
          {res.data.items.map((p) => (
            <Tr key={p.id}>
              <Td>
                <Link
                  href={`/admin/bookings/${p.booking.id}`}
                  className="font-mono font-medium hover:underline"
                >
                  {p.booking.reference}
                </Link>
                <p className="font-mono text-xs text-text-muted">
                  {p.reference} · {p.provider === 'TEST' ? 'Test provider' : 'Paystack'}
                </p>
                {p.failureReason && <p className="text-xs text-error">{p.failureReason}</p>}
              </Td>
              <Td>
                <p>{p.customer.fullName}</p>
                <p className="text-xs text-text-muted">{p.customer.email}</p>
              </Td>
              <Td className="whitespace-nowrap text-text-secondary">{formatMoment(p.createdAt)}</Td>
              <Td className="text-right tabular-nums">{formatKobo(p.amountKobo)}</Td>
              <Td>
                <PaymentStatusBadge status={p.status} />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={res.data} basePath="/admin/payments" params={params} />
    </>
  );
}

async function RefundsTab({ query, params }: { query: URLSearchParams; params: Params }) {
  const res = await serverApi<Paginated<AdminRefundListItem>>(`/admin/refunds?${query}`);
  if (!res.success) return <Alert tone="error">{res.message}</Alert>;
  return (
    <>
      <Filters
        searchable={false}
        hidden={{ tab: 'refunds' }}
        select={{
          name: 'status',
          label: 'Status',
          value: params.status,
          options: Object.entries(REFUND_STATUS_LABELS),
        }}
      />
      <Table caption="Refunds">
        <thead>
          <tr>
            <Th>Booking</Th>
            <Th>Reason</Th>
            <Th>Requested</Th>
            <Th className="text-right">Amount</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {res.data.items.length === 0 && <EmptyRow colSpan={5}>No refunds.</EmptyRow>}
          {res.data.items.map((r) => (
            <Tr key={r.id}>
              <Td>
                <Link
                  href={`/admin/bookings/${r.booking.id}`}
                  className="font-mono font-medium hover:underline"
                >
                  {r.booking.reference}
                </Link>
                <p className="text-xs text-text-muted">{r.customer.fullName}</p>
              </Td>
              <Td className="max-w-xs text-text-secondary">{r.reason}</Td>
              <Td className="whitespace-nowrap text-text-secondary">{formatMoment(r.createdAt)}</Td>
              <Td className="text-right tabular-nums">{formatKobo(r.amountKobo)}</Td>
              <Td>
                <RefundStatusBadge status={r.status} />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <p className="mt-3 text-xs text-text-muted">
        Open a booking to approve or reject its refund.
      </p>
      <Pagination page={res.data} basePath="/admin/payments" params={params} />
    </>
  );
}

async function RatesTab({ canEdit }: { canEdit: boolean }) {
  const res = await serverApi<{ current: PricingConfigView | null; history: PricingConfigView[] }>(
    '/admin/finance/pricing',
  );
  if (!res.success) return <Alert tone="error">{res.message}</Alert>;
  const { current, history } = res.data;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px] [&>*]:min-w-0">
      <Card>
        <CardHeader
          title={current ? `Current rates (version ${current.version})` : 'No rates configured'}
          description="Applied to new bookings. Existing bookings keep the rates they were made with."
        />
        <CardBody>
          {!current && (
            <Alert tone="warning">
              Online booking stays closed until rates are saved. HavenHub does not assume any
              commission or VAT rate.
            </Alert>
          )}
          {canEdit ? (
            <PricingConfigForm current={current} />
          ) : (
            current && (
              <p className="text-sm text-text-secondary">
                You can view rates. Changing them requires the “payments.settings” permission.
              </p>
            )
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="History" />
        <CardBody>
          {history.length === 0 ? (
            <p className="text-sm text-text-secondary">No versions yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {history.map((v) => (
                <li key={v.version} className="py-3">
                  <p className="font-medium text-text">
                    Version {v.version}
                    <span className="ml-2 font-normal text-text-muted">
                      {formatMoment(v.createdAt)}
                    </span>
                  </p>
                  <p className="text-text-secondary">
                    Fee {formatRate(v.serviceFeeBps)} · Commission{' '}
                    {formatRate(v.agentCommissionBps)} · VAT {formatRate(v.vatBps)}
                    {v.vatOnServiceFee ? ' on fee' : ''}
                    {v.vatOnStay ? ' + stay' : ''}
                    {v.agencyFeeBps > 0 && v.agencyFeePeriods.length > 0
                      ? ` · Agency fee ${formatRate(v.agencyFeeBps)} (${v.agencyFeePeriods
                          .map((p) => p.toLowerCase())
                          .join(', ')})`
                      : ''}
                  </p>
                  {v.note && <p className="text-xs text-text-muted">{v.note}</p>}
                  {v.createdBy && (
                    <p className="text-xs text-text-muted">By {v.createdBy.fullName}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
