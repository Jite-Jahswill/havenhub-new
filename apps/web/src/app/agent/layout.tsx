import type { ReactNode } from 'react';

import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { requireUser } from '@/lib/session';

export default async function AgentLayout({ children }: { children: ReactNode }) {
  const user = await requireUser('AGENT', '/agent');
  return <DashboardShell user={user}>{children}</DashboardShell>;
}
