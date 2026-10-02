import type { ReactNode } from 'react';

import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { requireUser } from '@/lib/session';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireUser('ADMIN', '/admin');
  return <DashboardShell user={user}>{children}</DashboardShell>;
}
