import { formatKobo, type AdminDiscountCodeDetail } from '@havenhub/shared';
import { Badge, Card, CardBody } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DiscountCodeActions } from '@/components/admin/discounts/discount-code-form';
import { DiscountStatus } from '@/components/admin/discounts/discount-status';
import { NoAccess } from '@/components/admin/no-access';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { formatDate } from '@/lib/format';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Discount code' };

const STATUS: Record<string, string> = {
  PENDING: 'Checkout open',
  REDEEMED: 'Paid',
  RELEASED: 'Payment failed',
};

export default async function DiscountPage({ params }: PageProps<'/admin/discounts/[id]'>) {
  const { id } = await params;
  const user = await requireUser('ADMIN', `/admin/discounts/${id}`);
  if (!hasPermission(user, 'discounts.manage')) return <NoAccess />;
  const res = await serverApi<AdminDiscountCodeDetail>(
    `/admin/discount-codes/${encodeURIComponent(id)}`,
  );
  if (!res.success) {
    if (res.code === 'NOT_FOUND' || res.code === 'VALIDATION_ERROR') notFound();
    return <NoAccess />;
  }
  const c = res.data;
  const rows: [string, string][] = [
    ['Discount', c.label],
    ['Plans', c.plans.length ? c.plans.map((p) => p.name).join(', ') : 'All paid plans'],
    [
      'Agents',
      c.agents.length ? c.agents.map((a) => `${a.name} (${a.email})`).join(', ') : 'Any agent',
    ],
    ['Starts', c.startsAt ? formatDate(c.startsAt) : 'Immediately'],
    ['Ends', c.endsAt ? formatDate(c.endsAt) : 'No end date'],
    [
      'Uses',
      `${c.redeemed} paid${c.maxRedemptions !== null ? ` of ${c.maxRedemptions}` : ''}${c.pending ? `, ${c.pending} checkout${c.pending === 1 ? '' : 's'} open` : ''}`,
    ],
    ['Per agent', String(c.perUserLimit)],
    ['Discount given', formatKobo(c.discountGivenKobo)],
    ['Created', `${formatDate(c.createdAt)}${c.createdBy ? ` by ${c.createdBy.fullName}` : ''}`],
  ];
  return (
    <>
      <Link href="/admin/discounts" className="text-sm text-text-secondary hover:text-text">
        ← Discounts
      </Link>
      <div className="mt-4">
        <PageHeader title={c.code} description={c.description ?? undefined} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardBody>
            <div className="mb-4">
              <DiscountStatus code={c} />
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-text-muted">{label}</dt>
                  <dd className="text-text">{value}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
        <Card className="self-start">
          <CardBody>
            <DiscountCodeActions code={c} />
          </CardBody>
        </Card>
      </div>
      <h2 className="mt-10 mb-3 text-lg font-semibold text-text">Uses</h2>
      <Table caption="Uses of this code">
        <thead>
          <tr>
            <Th>Agent</Th>
            <Th>Plan</Th>
            <Th className="text-right">Discount</Th>
            <Th>Status</Th>
            <Th>When</Th>
          </tr>
        </thead>
        <tbody>
          {c.redemptions.length === 0 ? (
            <EmptyRow colSpan={5}>Not used yet.</EmptyRow>
          ) : (
            c.redemptions.map((r) => (
              <Tr key={r.id}>
                <Td>
                  {r.user.name}
                  <span className="block text-xs text-text-muted">{r.user.email}</span>
                </Td>
                <Td>
                  {r.item}
                  <span className="block font-mono text-xs text-text-muted">{r.reference}</span>
                </Td>
                <Td className="text-right tabular-nums">{formatKobo(r.amountOffKobo)}</Td>
                <Td>
                  <Badge tone={r.status === 'REDEEMED' ? 'success' : 'neutral'}>
                    {STATUS[r.status]}
                  </Badge>
                </Td>
                <Td className="whitespace-nowrap">{formatDate(r.createdAt)}</Td>
              </Tr>
            ))
          )}
        </tbody>
      </Table>
    </>
  );
}
