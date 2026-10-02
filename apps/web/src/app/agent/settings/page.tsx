import type { SessionView } from '@havenhub/shared';
import type { Metadata } from 'next';

import { SecuritySettings } from '@/components/account/security-settings';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApiData } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Settings' };

export default async function AgentSettingsPage() {
  const sessions = (await serverApiData<SessionView[]>('/auth/sessions')) ?? [];
  return (
    <>
      <PageHeader title="Settings" description="Security and preferences." />
      <SecuritySettings sessions={sessions} />
    </>
  );
}
