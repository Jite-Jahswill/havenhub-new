import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ChatWorkspace } from '@/components/chat/chat-workspace';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { getPublicPolicies } from '@/lib/cms';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Messages' };

export default async function AgentMessagesPage() {
  const user = await requireUser('AGENT', '/agent/messages');
  return (
    <>
      <PageHeader
        title="Messages"
        description="Conversations with customers about your listings and bookings."
      />
      <Suspense>
        <ChatWorkspace
          viewerId={user.id}
          area="agent"
          contactWarning={(await getPublicPolicies()).chat.contactWarning}
        />
      </Suspense>
    </>
  );
}
