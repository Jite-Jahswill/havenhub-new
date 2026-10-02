import type { AdminConversationListItem, Paginated } from '@havenhub/shared';
import { Alert } from '@havenhub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Filters } from '@/components/admin/filters';
import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { contextLine } from '@/components/chat/chat-utils';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { formatMoment } from '@/lib/format';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Conversations' };

const str = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : undefined);

export default async function AdminConversationsPage({
  searchParams,
}: PageProps<'/admin/conversations'>) {
  const user = await requireUser('ADMIN', '/admin/conversations');
  if (!hasPermission(user, 'conversations.view')) {
    return (
      <>
        <PageHeader title="Conversations" />
        <NoAccess />
      </>
    );
  }
  const sp = await searchParams;
  const params = { search: str(sp.search), status: str(sp.status), page: str(sp.page) };
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const res = await serverApi<Paginated<AdminConversationListItem>>(
    `/admin/conversations?${query}`,
  );

  return (
    <>
      <PageHeader
        title="Conversations"
        description="Customer–agent conversations, for support and moderation. Opening a conversation is recorded in the audit log."
      />
      <Filters
        search={params.search}
        placeholder="Search by name, email, listing or booking reference"
        select={{
          name: 'status',
          label: 'Status',
          value: params.status,
          options: [
            ['OPEN', 'Open'],
            ['CLOSED', 'Closed'],
          ],
        }}
      />
      {!res.success ? (
        <Alert tone="error">{res.message}</Alert>
      ) : (
        <>
          <Table caption="Conversations">
            <thead>
              <tr>
                <Th>Participants</Th>
                <Th>About</Th>
                <Th className="text-right">Messages</Th>
                <Th>Last activity</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.length === 0 && <EmptyRow colSpan={5}>No conversations.</EmptyRow>}
              {res.data.items.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <Link
                      href={`/admin/conversations/${c.id}`}
                      className="font-medium hover:underline"
                    >
                      {c.participants.map((p) => p.name).join(' · ')}
                    </Link>
                    <span className="block text-xs text-text-muted">
                      {c.participants.map((p) => p.email).join(', ')}
                    </span>
                  </Td>
                  <Td className="text-sm">{contextLine(c)}</Td>
                  <Td className="text-right tabular-nums">{c.messageCount}</Td>
                  <Td className="text-xs">{formatMoment(c.lastActivityAt)}</Td>
                  <Td>{c.status === 'CLOSED' ? 'Closed' : 'Open'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={res.data} basePath="/admin/conversations" params={params} />
        </>
      )}
    </>
  );
}
