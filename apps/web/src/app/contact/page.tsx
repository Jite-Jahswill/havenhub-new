import type { Metadata } from 'next';

import { CmsPage, pageMetadata } from '@/components/cms/cms-page';
import { SupportEntry } from '@/components/cms/support-entry';
import { getSite } from '@/lib/cms';

export function generateMetadata(): Promise<Metadata> {
  return pageMetadata('contact', '/contact');
}

export default async function ContactPage() {
  const site = await getSite();
  const c = site.contact;
  return (
    <CmsPage
      slug="contact"
      aside={
        <div className="flex flex-col gap-6">
          {(c.email || c.phone || c.address) && (
            <address className="flex flex-col gap-2 rounded-card border border-border bg-surface p-6 text-sm text-text-secondary not-italic shadow-card">
              <span className="font-semibold text-text">{site.siteName}</span>
              {c.address && <span className="break-words">{c.address}</span>}
              {c.email && (
                <a href={`mailto:${c.email}`} className="break-all text-primary-text underline">
                  {c.email}
                </a>
              )}
              {c.phone && (
                <a
                  href={`tel:${c.phone.replace(/[^+0-9]/g, '')}`}
                  className="text-primary-text underline"
                >
                  {c.phone}
                </a>
              )}
            </address>
          )}
          <SupportEntry email={null} />
        </div>
      }
    />
  );
}
