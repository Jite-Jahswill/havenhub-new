import { SOCIAL_NETWORK_LABELS } from '@havenhub/shared';
import { Container } from '@havenhub/ui';
import Link from 'next/link';

import { NewsletterForm } from '@/components/cms/newsletter-form';
import { getSite } from '@/lib/cms';

/** Footer content comes from the CMS; links appear only for live features and published pages. */
export async function SiteFooter() {
  const site = await getSite();
  const links = [
    { href: '/experiences', label: 'Experiences' },
    ...(site.features.blog ? [{ href: '/blog', label: 'Blog' }] : []),
    ...(site.features.helpCenter ? [{ href: '/help', label: 'Help centre' }] : []),
    ...(site.features.careers ? [{ href: '/careers', label: 'Careers' }] : []),
    ...site.pages.map((p) => ({ href: `/${p.slug}`, label: p.title })),
  ];
  const contact = site.contact;
  return (
    <footer className="mt-auto border-t border-border bg-footer text-footer-foreground">
      <Container className="grid gap-10 py-12 text-sm md:grid-cols-[1.2fr_1fr_1fr]">
        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-base font-semibold">{site.siteName}</p>
          {(site.footerText ?? site.tagline) && (
            <p className="max-w-sm break-words whitespace-pre-line opacity-75">
              {site.footerText ?? site.tagline}
            </p>
          )}
          {(contact.email || contact.phone || contact.address) && (
            <address className="flex flex-col gap-1 not-italic opacity-75">
              {contact.address && <span className="break-words">{contact.address}</span>}
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="break-all hover:underline">
                  {contact.email}
                </a>
              )}
              {contact.phone && (
                <a
                  href={`tel:${contact.phone.replace(/[^+0-9]/g, '')}`}
                  className="hover:underline"
                >
                  {contact.phone}
                </a>
              )}
            </address>
          )}
        </div>
        <nav aria-label="Footer" className="flex flex-col gap-2">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="w-fit opacity-80 hover:underline hover:opacity-100"
            >
              {l.label}
            </Link>
          ))}
          {site.socialLinks.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1" aria-label="Social media">
              {site.socialLinks.map((s) => (
                <li key={s.url}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="opacity-80 hover:underline hover:opacity-100"
                  >
                    {SOCIAL_NETWORK_LABELS[s.network]}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </nav>
        <div className="min-w-0">
          {site.newsletter && <NewsletterForm consentText={site.newsletter.consentText} />}
        </div>
      </Container>
      <Container className="border-t border-white/10 py-5 text-xs opacity-70">
        © {new Date().getFullYear()} {site.siteName}. Made for Nigeria.
      </Container>
    </footer>
  );
}
