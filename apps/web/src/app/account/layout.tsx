import type { ReactNode } from 'react';

import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { requireUser } from '@/lib/session';

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const user = await requireUser('CUSTOMER', '/account');
  return <DashboardShell user={user}>{children}</DashboardShell>;
}
