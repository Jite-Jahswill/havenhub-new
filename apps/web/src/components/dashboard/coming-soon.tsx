import { Card } from '@havenhub/ui';
import { notFound } from 'next/navigation';

import { findPlaceholder, type NavItem } from '@/lib/navigation';

import { PageHeader } from './dashboard-shell';

/**
 * Honest placeholder for modules scheduled in later phases. Renders nothing
 * interactive: no fake data, no buttons that do nothing.
 */
export function ComingSoon({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <>
      <PageHeader title={item.label} badge={`Phase ${item.phase}`} />
      <Card className="flex flex-col items-center px-6 py-20 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-surface-secondary text-text-secondary">
          <Icon aria-hidden className="size-6" strokeWidth={1.6} />
        </span>
        <h2 className="mt-6 text-lg font-semibold text-text">Coming soon</h2>
        <p className="mt-2 max-w-md text-text-secondary">
          {item.description ??
            `${item.label} is being built and will be available in a future update.`}
        </p>
      </Card>
    </>
  );
}

/** Renders the placeholder registered for `href`, or a 404 for unknown sections. */
export function PlaceholderPage({ items, href }: { items: NavItem[]; href: string }) {
  const item = findPlaceholder(items, href);
  if (!item) notFound();
  return <ComingSoon item={item} />;
}
