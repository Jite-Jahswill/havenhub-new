import type { AdminHomepageSection, AdminTestimonialView } from '@havenhub/shared';
import { buttonClasses } from '@havenhub/ui';
import { ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { HomepageEditor } from '@/components/admin/cms/homepage-editor';
import { TestimonialsManager } from '@/components/admin/cms/testimonials-manager';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { hasPermission, requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Homepage' };

export default async function AdminHomepagePage() {
  const user = await requireUser('ADMIN', '/admin/homepage');
  const [sections, testimonials] = await Promise.all([
    serverApi<AdminHomepageSection[]>('/admin/cms/homepage'),
    serverApi<AdminTestimonialView[]>('/admin/cms/testimonials'),
  ]);
  return (
    <>
      <PageHeader
        title="Homepage"
        description="Choose which sections appear, in what order, and what they say."
        action={
          <Link href="/" target="_blank" className={buttonClasses({ variant: 'secondary' })}>
            View homepage <ExternalLink aria-hidden className="size-4" />
          </Link>
        }
      />
      {!sections.success || !testimonials.success ? (
        <NoAccess />
      ) : (
        <div className="flex flex-col gap-8">
          <HomepageEditor sections={sections.data} />
          <TestimonialsManager
            items={testimonials.data}
            canUpload={hasPermission(user, 'content.media')}
          />
        </div>
      )}
    </>
  );
}
