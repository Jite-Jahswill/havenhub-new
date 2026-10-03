import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ChatWorkspace } from '@/components/chat/chat-workspace';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Messages' };

/** Support staff answer the support conversations they have joined (Phase 5 chat). */
export default async function AdminMessagesPage() {
  const user = await requireUser('ADMIN', '/admin/messages');
  if (!hasPermission(user, 'support.respond')) return <NoAccess />;
  return (
    <>
      <PageHeader title="Messages" description="Support conversations you have joined." />
      <Suspense>
        <ChatWorkspace viewerId={user.id} area="admin" />
      </Suspense>
    </>
  );
}
