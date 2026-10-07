import { formatKobo, type AdminDiscountCodeView, type Paginated } from '@havenhub/shared';
import { buttonClasses } from '@havenhub/ui';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { DiscountStatus } from '@/components/admin/discounts/discount-status';
import { Filters } from '@/components/admin/filters';
import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { formatDate } from '@/lib/format';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Discounts' };
const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);

export default async function DiscountsPage({ searchParams }: PageProps<'/admin/discounts'>) {
  const user = await requireUser('ADMIN', '/admin/discounts');
  if (!hasPermission(user, 'discounts.manage')) return <NoAccess />;
  const sp = await searchParams;
  const params = { search: str(sp.search), status: str(sp.status), page: str(sp.page) };
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const res = await serverApi<Paginated<AdminDiscountCodeView>>(`/admin/discount-codes?${query}`);

  return (
    <>
      <PageHeader
        title="Discounts"
        description="Codes agents can use for money off their subscription plan."
        action={
          <Link href="/admin/discounts/new" className={buttonClasses()}>
            <Plus aria-hidden className="size-4" /> New code
          </Link>
        }
      />
      <Filters
        search={params.search}
        placeholder="Search by code"
        select={{
          name: 'status',
          label: 'Status',
          value: params.status,
          options: [
            ['ACTIVE', 'Active'],
            ['INACTIVE', 'Switched off'],
          ],
        }}
      />
      {res.success ? (
        <>
          <Table caption="Discount codes">
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Discount</Th>
                <Th>Applies to</Th>
                <Th className="text-right">Used</Th>
                <Th>Ends</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.length === 0 ? (
                <EmptyRow colSpan={6}>No discount codes yet.</EmptyRow>
              ) : (
                res.data.items.map((c) => (
                  <Tr key={c.id}>
                    <Td>
                      <Link
                        href={`/admin/discounts/${c.id}`}
                        className="font-mono font-semibold text-text hover:underline"
                      >
                        {c.code}
                      </Link>
                      {c.description && (
                        <p className="text-xs text-text-secondary">{c.description}</p>
                      )}
                    </Td>
                    <Td>{c.label}</Td>
                    <Td className="text-sm text-text-secondary">
                      {c.plans.length ? c.plans.map((p) => p.name).join(', ') : 'All paid plans'}
                      <br />
                      {c.agents.length
                        ? `${c.agents.length} agent${c.agents.length === 1 ? '' : 's'}`
                        : 'Any agent'}
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
          <Pagination page={res.data} basePath="/admin/discounts" params={params} />
        </>
      ) : (
        <NoAccess />
      )}
    </>
  );
}
