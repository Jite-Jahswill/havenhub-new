import { formatKobo, type AdminDiscountCodeView, type Paginated } from '@havenhub/shared';
import { Card, buttonClasses } from '@havenhub/ui';
import { Plus, Tag } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { DiscountStatus } from '@/components/admin/discounts/discount-status';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { formatDate } from '@/lib/format';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Promotions' };

export default async function PromotionsPage({ searchParams }: PageProps<'/agent/promotions'>) {
  await requireUser('AGENT', '/agent/promotions');
  const sp = await searchParams;
  const page = typeof sp.page === 'string' ? sp.page : '1';
  const res = await serverApi<Paginated<AdminDiscountCodeView>>(
    `/agents/me/promo-codes?page=${encodeURIComponent(page)}`,
  );
  return (
    <>
      <PageHeader
        title="Promotions"
        description="Promo codes customers can enter when they book your rentals."
        action={
          <Link href="/agent/promotions/new" className={buttonClasses()}>
            <Plus aria-hidden className="size-4" /> New code
          </Link>
        }
      />
      {!res.success ? (
        <Card className="p-6 text-text-secondary">{res.message}</Card>
      ) : res.data.total === 0 ? (
        <Card className="flex flex-col items-center px-6 py-16 text-center">
          <Tag aria-hidden className="size-8 text-text-muted" strokeWidth={1.6} />
          <h2 className="mt-4 font-semibold text-text">No promo codes yet</h2>
          <p className="mt-2 max-w-sm text-sm text-text-secondary">
            Create a code, then share it with your customers. To discount a listing for everyone,
            set a discount on the listing itself instead.
          </p>
        </Card>
      ) : (
        <>
          <Table caption="Your promo codes">
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Discount</Th>
                <Th>Properties</Th>
                <Th className="text-right">Used</Th>
                <Th>Ends</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.length === 0 ? (
                <EmptyRow colSpan={6}>No codes on this page.</EmptyRow>
              ) : (
                res.data.items.map((c) => (
                  <Tr key={c.id}>
                    <Td>
                      <Link
                        href={`/agent/promotions/${c.id}`}
                        className="font-mono font-semibold text-text hover:underline"
                      >
                        {c.code}
                      </Link>
                    </Td>
                    <Td>{c.label}</Td>
                    <Td className="text-sm text-text-secondary">
                      {c.properties.length
                        ? c.properties.map((p) => p.title).join(', ')
                        : 'All rentals'}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {c.redeemed}
                      {c.maxRedemptions !== null && ` / ${c.maxRedemptions}`}
                      {c.discountGivenKobo > 0 && (
                        <span className="block text-xs text-text-muted">
                          {formatKobo(c.discountGivenKobo)} off
                        </span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">{c.endsAt ? formatDate(c.endsAt) : '—'}</Td>
                    <Td>
                      <DiscountStatus code={c} />
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
          <Pagination page={res.data} basePath="/agent/promotions" params={{}} />
        </>
      )}
    </>
  );
}
