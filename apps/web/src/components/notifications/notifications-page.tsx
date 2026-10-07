import type { NotificationPage } from '@havenhub/shared';
import { Card } from '@havenhub/ui';

import { Pagination } from '@/components/admin/pagination';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';

import { NotificationInbox } from './notification-inbox';

/** The inbox page body, shared by the customer and agent dashboards. */
export async function NotificationsPage({
  basePath,
  searchParams,
}: {
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const page = typeof searchParams.page === 'string' ? searchParams.page : '1';
  const unreadOnly = searchParams.unread === 'true';
  const res = await serverApi<NotificationPage>(
    `/notifications?page=${encodeURIComponent(page)}&pageSize=20${unreadOnly ? '&unread=true' : ''}`,
  );
  return (
    <>
      <PageHeader title="Notifications" description="Updates about your bookings and account." />
      {res.success ? (
        <>
          <NotificationInbox page={res.data} basePath={basePath} unreadOnly={unreadOnly} />
          <Pagination
            page={res.data}
            basePath={basePath}
            params={{ unread: unreadOnly ? 'true' : undefined }}
          />
        </>
      ) : (
        <Card className="p-6 text-text-secondary">{res.message}</Card>
      )}
    </>
  );
}
