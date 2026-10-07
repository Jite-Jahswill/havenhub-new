import {
  NOTIFICATION_AUDIENCE_LABELS,
  type NotificationBroadcastView,
  type Paginated,
} from '@havenhub/shared';
import type { Metadata } from 'next';

import { AnnouncementForm } from '@/components/admin/announcement-form';
import { NoAccess } from '@/components/admin/no-access';
import { Pagination } from '@/components/admin/pagination';
import { EmptyRow, Table, Td, Th, Tr } from '@/components/admin/table';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { formatDate } from '@/lib/format';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Announcements' };

export default async function AnnouncementsPage({
  searchParams,
}: PageProps<'/admin/announcements'>) {
  const user = await requireUser('ADMIN', '/admin/announcements');
  if (!hasPermission(user, 'notifications.send')) return <NoAccess />;
  const sp = await searchParams;
  const page = typeof sp.page === 'string' ? sp.page : '1';
  const res = await serverApi<Paginated<NotificationBroadcastView>>(
    `/admin/notifications/broadcasts?page=${encodeURIComponent(page)}&pageSize=20`,
  );
  return (
    <>
      <PageHeader
        title="Announcements"
        description="Send an in-app notification to customers, agents or one person."
      />
      <div className="grid gap-8 xl:grid-cols-[minmax(0,28rem)_1fr]">
        <AnnouncementForm />
        <section aria-labelledby="sent">
          <h2 id="sent" className="mb-3 text-lg font-semibold text-text">
            Sent
          </h2>
          {res.success ? (
            <>
              <Table caption="Sent announcements">
                <thead>
                  <tr>
                    <Th>Title</Th>
                    <Th>Audience</Th>
                    <Th className="text-right">Recipients</Th>
                    <Th>Sent</Th>
                  </tr>
                </thead>
                <tbody>
                  {res.data.items.length === 0 ? (
                    <EmptyRow colSpan={4}>Nothing sent yet.</EmptyRow>
                  ) : (
                    res.data.items.map((b) => (
                      <Tr key={b.id}>
                        <Td>
                          <p className="font-medium text-text">{b.title}</p>
                          <p className="line-clamp-2 text-xs text-text-secondary">{b.body}</p>
                        </Td>
                        <Td>
                          {b.audience === 'USER'
                            ? b.recipientEmail
                            : NOTIFICATION_AUDIENCE_LABELS[b.audience]}
                        </Td>
                        <Td className="text-right tabular-nums">{b.recipientCount}</Td>
                        <Td className="whitespace-nowrap">
                          {formatDate(b.createdAt)}
                          {b.sentBy && (
                            <span className="block text-xs text-text-muted">
                              {b.sentBy.fullName}
                            </span>
                          )}
                        </Td>
                      </Tr>
                    ))
                  )}
                </tbody>
              </Table>
              <Pagination page={res.data} basePath="/admin/announcements" params={{}} />
            </>
          ) : (
            <NoAccess />
          )}
        </section>
      </div>
    </>
  );
}
