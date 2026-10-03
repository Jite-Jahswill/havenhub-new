import type { Permission } from '@havenhub/shared';
import { Card } from '@havenhub/ui';
import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Settings' };

interface Entry {
  href: string;
  title: string;
  description: string;
  permission: Permission;
}

/** Configured on this screen's own pages. */
const PLATFORM: Entry[] = [
  {
    href: '/admin/settings/smtp',
    title: 'Outgoing email (SMTP)',
    description: 'The mail server HavenHub sends email through. The password is never shown again.',
    permission: 'settings.smtp',
  },
  {
    href: '/admin/settings/maintenance',
    title: 'Maintenance mode',
    description: 'Take the public site offline while administrators keep working.',
    permission: 'settings.maintenance',
  },
  {
    href: '/admin/settings/moderation',
    title: 'Moderation policy',
    description: 'Whether each listing type needs admin review before it is published.',
    permission: 'settings.manage',
  },
];

/** Already managed elsewhere — linked, not duplicated. */
const ELSEWHERE: Entry[] = [
  {
    href: '/admin/payments',
    title: 'Payments, commission & VAT',
    description: 'Service fee, agent commission and VAT rates.',
    permission: 'payments.settings',
  },
  {
    href: '/admin/plans',
    title: 'Subscriptions',
    description: 'Agent plans, prices and limits.',
    permission: 'subscriptions.plans',
  },
  {
    href: '/admin/content',
    title: 'General & branding',
    description: 'Site name, logo, contact details and features.',
    permission: 'content.site',
  },
  {
    href: '/admin/homepage',
    title: 'Homepage',
    description: 'Sections, order and wording.',
    permission: 'content.site',
  },
  {
    href: '/admin/seo',
    title: 'SEO',
    description: 'Titles, descriptions, robots and sitemap.',
    permission: 'seo.manage',
  },
  {
    href: '/admin/careers',
    title: 'Careers',
    description: 'Job postings.',
    permission: 'careers.manage',
  },
  {
    href: '/admin/help',
    title: 'Help centre',
    description: 'Articles, categories and FAQs.',
    permission: 'help.manage',
  },
];

const NOT_YET = [
  'Security',
  'Storage',
  'Booking',
  'Refunds',
  'Withdrawals',
  'Reviews',
  'Chat',
  'Events',
  'Notifications',
];

function EntryCard({ entry }: { entry: Entry }) {
  return (
    <Link href={entry.href} className="group block">
      <Card className="flex h-full items-center gap-4 p-5 transition-colors group-hover:border-border-strong">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-text">{entry.title}</p>
          <p className="mt-1 text-sm text-text-secondary">{entry.description}</p>
        </div>
        <ChevronRight aria-hidden className="size-5 shrink-0 text-text-muted" />
      </Card>
    </Link>
  );
}

export default async function SettingsHubPage() {
  const user = await requireUser('ADMIN', '/admin/settings');
  const platform = PLATFORM.filter((e) => hasPermission(user, e.permission));
  const elsewhere = ELSEWHERE.filter((e) => hasPermission(user, e.permission));

  return (
    <>
      <PageHeader
        title="Settings"
        description="Everything HavenHub can be configured with, in one place."
      />
      {platform.length + elsewhere.length === 0 ? (
        <NoAccess />
      ) : (
        <div className="flex flex-col gap-10">
          {platform.length > 0 && (
            <section aria-labelledby="platform-settings">
              <h2 id="platform-settings" className="mb-4 text-lg font-semibold text-text">
                Platform
              </h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {platform.map((e) => (
                  <EntryCard key={e.href} entry={e} />
                ))}
              </div>
            </section>
          )}
          {elsewhere.length > 0 && (
            <section aria-labelledby="other-settings">
              <h2 id="other-settings" className="mb-4 text-lg font-semibold text-text">
                Managed in their own sections
              </h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {elsewhere.map((e) => (
                  <EntryCard key={e.href} entry={e} />
                ))}
              </div>
            </section>
          )}
          <section aria-labelledby="not-yet">
            <h2 id="not-yet" className="mb-2 text-lg font-semibold text-text">
              Not configurable yet
            </h2>
            <p className="max-w-2xl text-sm text-text-secondary">
              {NOT_YET.join(', ')} have no admin settings in this version; they follow the
              platform’s built-in behaviour.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
