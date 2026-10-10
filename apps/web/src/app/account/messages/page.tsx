import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ChatWorkspace } from '@/components/chat/chat-workspace';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { getPublicPolicies } from '@/lib/cms';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Messages' };

export default async function CustomerMessagesPage() {
  const user = await requireUser('CUSTOMER', '/account/messages');
  return (
    <>
      <PageHeader
        title="Messages"
        description="Your conversations with agents about listings and bookings."
      />
      <Suspense>
        <ChatWorkspace
          viewerId={user.id}
          area="account"
          contactWarning={(await getPublicPolicies()).chat.contactWarning}
        />
      </Suspense>
    </>
  );
}
