import type { AdminCampaignView, AdminSubscriberView, Paginated } from '@havenhub/shared';
import { Badge, buttonClasses } from '@havenhub/ui';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { CampaignBadge } from '@/components/admin/cms/campaign-editor';
import { Filters } from '@/components/admin/filters';
import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { getSite } from '@/lib/cms';
import { formatDate } from '@/lib/format';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Email marketing' };
const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);
const SUB_STATUS: [string, string][] = [
  ['SUBSCRIBED', 'Subscribed'],
  ['PENDING', 'Awaiting confirmation'],
  ['UNSUBSCRIBED', 'Unsubscribed'],
];

export default async function EmailMarketingPage({
  searchParams,
}: PageProps<'/admin/email-marketing'>) {
  const user = await requireUser('ADMIN', '/admin/email-marketing');
  const sp = await searchParams;
  const tab = sp.tab === 'subscribers' ? 'subscribers' : 'campaigns';
  const params = { tab, search: str(sp.search), status: str(sp.status), page: str(sp.page) };
  const query = new URLSearchParams(
    Object.entries({ search: params.search, status: params.status, page: params.page }).filter(
      (e): e is [string, string] => Boolean(e[1]),
    ),
  );
  const site = await getSite();
  const chip =
    'rounded-full border border-border px-3.5 py-1.5 text-sm font-medium text-text hover:bg-surface-secondary aria-[current=page]:bg-surface-inverse aria-[current=page]:text-text-inverse';

  return (
    <>
      <PageHeader
        title="Email marketing"
        description={
          site.features.newsletter
            ? 'Newsletter signup is live.'
            : 'Newsletter signup is switched off in site settings.'
        }
        action={
          tab === 'campaigns' && hasPermission(user, 'marketing.campaigns') ? (
            <Link href="/admin/email-marketing/campaigns/new" className={buttonClasses()}>
              <Plus aria-hidden className="size-4" /> New campaign
            </Link>
          ) : undefined
        }
      />
      <nav aria-label="Email marketing" className="mb-6 flex gap-2">
        <Link
          href="/admin/email-marketing"
          aria-current={tab === 'campaigns' ? 'page' : undefined}
          className={chip}
        >
          Campaigns
        </Link>
        <Link
          href="/admin/email-marketing?tab=subscribers"
          aria-current={tab === 'subscribers' ? 'page' : undefined}
          className={chip}
        >
          Subscribers
        </Link>
      </nav>
      {tab === 'campaigns' ? (
        <Campaigns query={query} params={params} />
      ) : (
        <Subscribers query={query} params={params} />
      )}
    </>
  );
}

async function Campaigns({
  query,
  params,
}: {
  query: URLSearchParams;
  params: Record<string, string | undefined>;
}) {
  const res = await serverApi<Paginated<AdminCampaignView>>(`/admin/newsletter/campaigns?${query}`);
  if (!res.success) return <NoAccess />;
  return (
    <>
      <Table caption="Campaigns">
        <thead>
          <tr>
            <Th>Campaign</Th>
            <Th>Sent</Th>
            <Th>Updated</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {res.data.items.length === 0 && <EmptyRow colSpan={4}>No campaigns yet.</EmptyRow>}
          {res.data.items.map((c) => (
            <Tr key={c.id} className="hover:bg-surface-secondary/60">
              <Td>
                <Link
                  href={`/admin/email-marketing/campaigns/${c.id}`}
                  className="font-medium hover:underline"
                >
                  {c.name}
                </Link>
                <p className="text-xs text-text-muted">{c.subject}</p>
              </Td>
              <Td className="text-text-secondary tabular-nums">
                {c.stats.sent}/{c.stats.total || '—'}
              </Td>
              <Td className="whitespace-nowrap text-text-secondary">{formatDate(c.updatedAt)}</Td>
              <Td>
                <CampaignBadge status={c.status} />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={res.data} basePath="/admin/email-marketing" params={params} />
    </>
  );
}

async function Subscribers({
  query,
  params,
}: {
  query: URLSearchParams;
  params: Record<string, string | undefined>;
}) {
  const res = await serverApi<Paginated<AdminSubscriberView>>(
    `/admin/newsletter/subscribers?${query}`,
  );
  if (!res.success) return <NoAccess />;
  return (
    <>
      <Filters
        search={params.search}
        placeholder="Search by email"
        select={{ name: 'status', label: 'Status', value: params.status, options: SUB_STATUS }}
        hidden={{ tab: 'subscribers' }}
      />
      <Table caption="Subscribers">
        <thead>
          <tr>
            <Th>Email</Th>
            <Th>Consent given</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {res.data.items.length === 0 && <EmptyRow colSpan={3}>No subscribers match.</EmptyRow>}
          {res.data.items.map((s) => (
            <Tr key={s.id} className="hover:bg-surface-secondary/60">
              <Td>
                <Link
                  href={`/admin/email-marketing/subscribers/${s.id}`}
                  className="font-medium break-all hover:underline"
                >
                  {s.email}
                </Link>
              </Td>
              <Td className="whitespace-nowrap text-text-secondary">
                {s.consentAt ? formatDate(s.consentAt) : '—'}
              </Td>
              <Td>
                <Badge
                  tone={
                    s.status === 'SUBSCRIBED'
                      ? 'success'
                      : s.status === 'PENDING'
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  {SUB_STATUS.find(([k]) => k === s.status)?.[1]}
                </Badge>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={res.data} basePath="/admin/email-marketing" params={params} />
    </>
  );
}
