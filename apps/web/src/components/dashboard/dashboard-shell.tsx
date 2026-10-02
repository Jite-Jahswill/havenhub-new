'use client';

import type { AuthUser } from '@havenhub/shared';
import { Badge, cn } from '@havenhub/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { visibleNav, type NavItem } from '@/lib/navigation';

import { SignOutButton } from '../auth/sign-out-button';

const TITLES = {
  CUSTOMER: 'My account',
  AGENT: 'Agent dashboard',
  ADMIN: 'Administration',
} as const;

/**
 * Shared dashboard frame: a calm sidebar on desktop, a scrollable tab row on
 * mobile. Navigation reflects the user's account type and (for admins)
 * permissions; the API enforces access independently.
 */
export function DashboardShell({ user, children }: { user: AuthUser; children: ReactNode }) {
  const pathname = usePathname();
  const items = visibleNav(user);
  const rootHref = items[0]?.href;
  const isActive = (item: NavItem) =>
    item.href === rootHref ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:flex-row lg:gap-12 lg:px-8 lg:py-12">
      <aside className="lg:w-60 lg:shrink-0">
        <div className="lg:sticky lg:top-26">
          <div className="mb-4 flex items-center justify-between gap-4 lg:hidden">
            <p className="min-w-0 truncate text-sm text-text-secondary">
              <span className="font-semibold text-text">{user.fullName}</span> ·{' '}
              {TITLES[user.accountType]}
            </p>
            <SignOutButton />
          </div>

          <div className="hidden lg:block">
            <p className="text-xs font-semibold tracking-wide text-text-muted uppercase">
              {TITLES[user.accountType]}
            </p>
            <p className="mt-2 truncate font-semibold text-text">{user.fullName}</p>
            <p className="truncate text-sm text-text-secondary">{user.email}</p>
          </div>

          <nav aria-label={TITLES[user.accountType]} className="lg:mt-8">
            <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
              {items.map((item) => {
                const active = isActive(item);
                const Icon = item.icon;
                return (
                  <li key={item.href} className="shrink-0">
                    {item.group && (
                      <p className="mt-5 mb-1.5 hidden px-3 text-[11px] font-semibold tracking-wide text-text-muted uppercase lg:block">
                        {item.group}
                      </p>
                    )}
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-control px-3 py-2 text-sm whitespace-nowrap transition-colors',
                        active
                          ? 'bg-surface-secondary font-semibold text-text'
                          : 'text-text-secondary hover:bg-surface-secondary hover:text-text',
                      )}
                    >
                      <Icon
                        aria-hidden
                        className={cn('size-4.5', active && 'text-primary')}
                        strokeWidth={1.8}
                      />
                      <span>{item.label}</span>
                      {item.phase !== undefined && (
                        <span className="ml-auto hidden text-[11px] font-medium text-text-muted lg:inline">
                          Soon
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="mt-8 hidden border-t border-border pt-6 lg:block">
            <SignOutButton />
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
  badge,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  badge?: string;
}) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">{title}</h1>
          {badge && <Badge>{badge}</Badge>}
        </div>
        {description && <p className="mt-2 max-w-2xl text-text-secondary">{description}</p>}
      </div>
      {action && <div className="shrink-0 self-start sm:self-end">{action}</div>}
    </header>
  );
}
