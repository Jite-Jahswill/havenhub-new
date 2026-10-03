import { Container, Logo, buttonClasses } from '@havenhub/ui';
import Link from 'next/link';

import { getSite } from '@/lib/cms';
import { DASHBOARD_PATH } from '@/lib/navigation';
import { getCurrentUser } from '@/lib/session';

import { ThemeToggle } from './theme-toggle';

export async function SiteHeader() {
  const [user, site] = await Promise.all([getCurrentUser(), getSite()]);
  const initials = user?.fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
      <Container className="flex h-18 items-center justify-between gap-4">
        <Link href="/" aria-label={`${site.siteName} home`} className="rounded-md">
          {site.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- admin-uploaded, re-encoded logo
            <img
              src={site.logo.url}
              alt=""
              width={site.logo.width}
              height={site.logo.height}
              className="h-9 w-auto max-w-[160px] object-contain sm:max-w-[200px]"
            />
          ) : (
            /* Below 375px only the 32px roof mark fits beside the actions; crop to it. */
            <span className="block overflow-hidden max-[375px]:w-8">
              <Logo />
            </span>
          )}
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link href="/properties" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
            Explore
          </Link>
          <Link
            href="/experiences"
            className={buttonClasses({
              variant: 'ghost',
              size: 'sm',
              className: 'hidden sm:inline-flex',
            })}
          >
            Experiences
          </Link>
          <div className="md:hidden">
            <ThemeToggle variant="compact" />
          </div>
          <div className="hidden md:block">
            <ThemeToggle />
          </div>
          {user ? (
            <Link
              href={DASHBOARD_PATH[user.accountType]}
              aria-label="Dashboard"
              className="flex items-center gap-2.5 rounded-full border border-border p-1 text-sm font-medium text-text hover:bg-surface-secondary sm:pr-4"
            >
              <span
                aria-hidden
                className="grid size-8 place-items-center rounded-full bg-surface-inverse text-xs font-semibold text-text-inverse"
              >
                {initials}
              </span>
              <span className="hidden sm:inline">Dashboard</span>
            </Link>
          ) : (
            <>
              <Link href="/login" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
                Sign in
              </Link>
              <Link
                href="/register"
                className={buttonClasses({ size: 'sm', className: 'hidden sm:inline-flex' })}
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </Container>
    </header>
  );
}
