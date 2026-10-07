import type { Metadata } from 'next';

import { NotificationsPage } from '@/components/notifications/notifications-page';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Notifications' };

export default async function AgentNotificationsPage({
  searchParams,
}: PageProps<'/agent/notifications'>) {
  await requireUser('AGENT', '/agent/notifications');
  return <NotificationsPage basePath="/agent/notifications" searchParams={await searchParams} />;
}
