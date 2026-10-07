import { formatKobo, type AdminDiscountCodeDetail } from '@havenhub/shared';
import { Badge, Card, CardBody } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DiscountStatus } from '@/components/admin/discounts/discount-status';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { PromoCodeToggle } from '@/components/promotions/promo-code-form';
import { serverApi } from '@/lib/api/server';
import { formatDate } from '@/lib/format';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Promo code' };

const STATUS: Record<string, string> = {
  PENDING: 'Awaiting payment',
  REDEEMED: 'Paid',
  RELEASED: 'Not used (expired or cancelled)',
};

export default async function PromoCodePage({ params }: PageProps<'/agent/promotions/[id]'>) {
  const { id } = await params;
  await requireUser('AGENT', `/agent/promotions/${id}`);
  const res = await serverApi<AdminDiscountCodeDetail>(
    `/agents/me/promo-codes/${encodeURIComponent(id)}`,
  );
  if (!res.success) notFound();
  const c = res.data;
  const rows: [string, string][] = [
    ['Discount', c.label],
    [
      'Properties',
      c.properties.length ? c.properties.map((p) => p.title).join(', ') : 'All rentals',
    ],
    ['Starts', c.startsAt ? formatDate(c.startsAt) : 'Immediately'],
    ['Ends', c.endsAt ? formatDate(c.endsAt) : 'No end date'],
    [
      'Uses',
      `${c.redeemed} paid${c.maxRedemptions !== null ? ` of ${c.maxRedemptions}` : ''}${c.pending ? `, ${c.pending} awaiting payment` : ''}`,
    ],
    ['Per customer', String(c.perUserLimit)],
    ['Discount given', formatKobo(c.discountGivenKobo)],
  ];
  return (
    <>
      <Link href="/agent/promotions" className="text-sm text-text-secondary hover:text-text">
        ← Promotions
      </Link>
      <div className="mt-4">
        <PageHeader title={c.code} description={c.description ?? undefined} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <Card>
          <CardBody>
            <div className="mb-4">
              <DiscountStatus code={c} />
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-[9rem_1fr]">
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
            <PromoCodeToggle id={c.id} active={c.active} />
          </CardBody>
        </Card>
      </div>
      <h2 className="mt-10 mb-3 text-lg font-semibold text-text">Bookings with this code</h2>
      <Table caption="Bookings with this code">
        <thead>
          <tr>
            <Th>Customer</Th>
            <Th>Booking</Th>
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
                <Td>{r.user.name}</Td>
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
