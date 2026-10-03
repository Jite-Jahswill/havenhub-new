import type { SmtpSettingsView } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { NoAccess } from '@/components/admin/no-access';
import { SmtpForm } from '@/components/admin/platform/smtp-form';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Outgoing email' };

export default async function SmtpSettingsPage() {
  const user = await requireUser('ADMIN', '/admin/settings/smtp');
  const res = await serverApi<SmtpSettingsView>('/admin/settings/smtp');
  return (
    <>
      <Link href="/admin/settings" className="text-sm text-text-secondary hover:text-text">
        ← Settings
      </Link>
      <div className="mt-4">
        <PageHeader
          title="Outgoing email (SMTP)"
          description="Settings saved here override the server's SMTP configuration for all email HavenHub sends."
        />
      </div>
      {res.success ? <SmtpForm settings={res.data} email={user.email} /> : <NoAccess />}
    </>
  );
}
