import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

import { Assistant } from '@/components/assistant/assistant';
import { Popups } from '@/components/popups/popups';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { ThemeProvider } from '@/components/theme-provider';
import { absoluteUrl, getSite } from '@/lib/cms';
import { env } from '@/lib/env';

import './globals.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  display: 'swap',
});

const DEFAULT_TITLE = 'HavenHub — Find your next place to live, stay, work or explore';
const DEFAULT_DESCRIPTION =
  'HavenHub is Nigeria’s trusted marketplace for rentals, short stays, property and land sales, hotels, events and experiences.';

/** Site-wide defaults come from the CMS (site settings + SEO dashboard). */
export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  const title = site.seo.title ?? DEFAULT_TITLE;
  const description = site.seo.description ?? DEFAULT_DESCRIPTION;
  return {
    metadataBase: new URL(env.NEXT_PUBLIC_SITE_URL),
    title: { default: title, template: `%s · ${site.siteName}` },
    description,
    applicationName: site.siteName,
    ...(site.seo.keywords.length ? { keywords: site.seo.keywords } : {}),
    ...(site.faviconUrl ? { icons: { icon: [{ url: site.faviconUrl, type: 'image/png' }] } } : {}),
    openGraph: {
      siteName: site.siteName,
      type: 'website',
      locale: 'en_NG',
      ...(site.seo.ogImageUrl ? { images: [{ url: absoluteUrl(site.seo.ogImageUrl) }] } : {}),
    },
    twitter: {
      card: site.seo.ogImageUrl ? 'summary_large_image' : 'summary',
      ...(site.seo.twitterHandle ? { site: site.seo.twitterHandle } : {}),
    },
    ...(site.seo.allowIndexing ? {} : { robots: { index: false, follow: false } }),
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#121212' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NG" className={jakarta.variable} suppressHydrationWarning>
      <body className="flex min-h-dvh flex-col font-sans">
        <ThemeProvider>
          <a
            href="#main"
            className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
          >
            Skip to content
          </a>
          <SiteHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
          <Popups />
          <Assistant />
        </ThemeProvider>
      </body>
    </html>
  );
}
