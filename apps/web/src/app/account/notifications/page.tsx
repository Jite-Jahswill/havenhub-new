import type { Metadata } from 'next';

import { NotificationsPage } from '@/components/notifications/notifications-page';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Notifications' };

export default async function CustomerNotificationsPage({
  searchParams,
}: PageProps<'/account/notifications'>) {
  await requireUser('CUSTOMER', '/account/notifications');
  return <NotificationsPage basePath="/account/notifications" searchParams={await searchParams} />;
}
