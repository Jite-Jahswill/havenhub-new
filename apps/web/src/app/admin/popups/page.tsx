import { POPUP_KIND_LABELS, type AdminPopupView, type Paginated } from '@havenhub/shared';
import { Badge, buttonClasses } from '@havenhub/ui';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { formatDate } from '@/lib/format';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Pop-ups' };

function status(p: AdminPopupView) {
  const now = new Date();
  if (!p.active) return <Badge>Off</Badge>;
  if (p.endsAt && new Date(p.endsAt) <= now) return <Badge>Ended</Badge>;
  if (p.startsAt && new Date(p.startsAt) > now) return <Badge tone="warning">Scheduled</Badge>;
  if (p.kind === 'PROPERTY' && !p.property) return <Badge tone="warning">Property hidden</Badge>;
  return <Badge tone="success">Live</Badge>;
}

export default async function PopupsPage({ searchParams }: PageProps<'/admin/popups'>) {
  const user = await requireUser('ADMIN', '/admin/popups');
  if (!hasPermission(user, 'popups.manage')) return <NoAccess />;
  const sp = await searchParams;
  const page = typeof sp.page === 'string' ? sp.page : '1';
  const res = await serverApi<Paginated<AdminPopupView>>(
    `/admin/popups?page=${encodeURIComponent(page)}`,
  );
  return (
    <>
      <PageHeader
        title="Pop-ups"
        description="Announcements, what's new, offers and featured properties shown on the site."
        action={
          <Link href="/admin/popups/new" className={buttonClasses()}>
            <Plus aria-hidden className="size-4" /> New pop-up
          </Link>
        }
      />
      {res.success ? (
        <>
          <Table caption="Pop-ups">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th className="text-right">Views</Th>
                <Th className="text-right">Clicks</Th>
                <Th>Ends</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.length === 0 ? (
                <EmptyRow colSpan={6}>No pop-ups yet.</EmptyRow>
              ) : (
                res.data.items.map((p) => (
                  <Tr key={p.id}>
                    <Td>
                      <Link
                        href={`/admin/popups/${p.id}`}
                        className="font-medium text-text hover:underline"
                      >
                        {p.name}
                      </Link>
                      <span className="block text-xs text-text-secondary">{p.title}</span>
                    </Td>
                    <Td>{POPUP_KIND_LABELS[p.kind]}</Td>
                    <Td className="text-right tabular-nums">{p.views}</Td>
                    <Td className="text-right tabular-nums">
                      {p.clicks}
                      {p.views > 0 && (
                        <span className="block text-xs text-text-muted">
                          {Math.round((p.clicks / p.views) * 100)}%
                        </span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">{p.endsAt ? formatDate(p.endsAt) : '—'}</Td>
                    <Td>{status(p)}</Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
          <Pagination page={res.data} basePath="/admin/popups" params={{}} />
        </>
      ) : (
        <NoAccess />
      )}
    </>
  );
}
