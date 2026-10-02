import type { AgentPlanUsageView, AgentPropertyListItem } from '@havenhub/shared';
import { Card, buttonClasses } from '@havenhub/ui';
import { Building2, Eye, Heart, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { PropertyStatusBadge } from '@/components/dashboard/status-badge';
import { Photo } from '@/components/properties/photo';
import { serverApiData } from '@/lib/api/server';
import { formatPrice } from '@/lib/format';
import { PROPERTY_TYPE_LABELS } from '@/lib/labels';

export const metadata: Metadata = { title: 'My properties' };

export default async function AgentPropertiesPage() {
  const [properties, plan] = await Promise.all([
    serverApiData<AgentPropertyListItem[]>('/agents/me/properties'),
    serverApiData<AgentPlanUsageView>('/agents/me/plan'),
  ]);
  const usage = plan?.usage.find((u) => u.key === 'properties');
  const atLimit = usage && usage.limit !== null && usage.used !== null && usage.used >= usage.limit;

  return (
    <>
      <PageHeader
        title="Properties"
        description={
          usage
            ? `${usage.used} of ${usage.limit} active ${usage.limit === 1 ? 'listing' : 'listings'} on your ${plan?.planName} plan.`
            : undefined
        }
        action={
          atLimit ? (
            <span className="text-sm text-text-secondary">Archive a listing to add another.</span>
          ) : (
            <Link href="/agent/properties/new" className={buttonClasses()}>
              <Plus aria-hidden className="size-4" /> Add property
            </Link>
          )
        }
      />

      {!properties?.length ? (
        <Card className="flex flex-col items-center px-6 py-20 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-surface-secondary text-text-secondary">
            <Building2 aria-hidden className="size-6" strokeWidth={1.6} />
          </span>
          <h2 className="mt-6 text-lg font-semibold text-text">List your first property</h2>
          <p className="mt-2 max-w-sm text-text-secondary">
            Add a home, short stay, shop or land. You can save a draft and finish it later.
          </p>
          <Link href="/agent/properties/new" className={buttonClasses({ className: 'mt-6' })}>
            Add property
          </Link>
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {properties.map((p) => (
            <li key={p.id}>
              <Link
                href={`/agent/properties/${p.id}`}
                className="flex gap-4 rounded-card border border-border bg-surface p-4 shadow-card transition-colors hover:bg-surface-secondary sm:gap-6"
              >
                <div className="relative aspect-[4/3] w-28 shrink-0 overflow-hidden rounded-control bg-surface-secondary sm:w-40">
                  {p.coverImage && <Photo src={p.coverImage.thumbnailUrl} alt="" sizes="160px" />}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <PropertyStatusBadge status={p.status} />
                    <span className="text-xs text-text-muted">
                      {PROPERTY_TYPE_LABELS[p.propertyType]}
                    </span>
                  </div>
                  <h2 className="truncate font-semibold text-text">{p.title}</h2>
                  <p className="text-sm text-text-secondary">
                    {[p.city, p.state].filter(Boolean).join(', ') || 'Location not set'}
                    {p.priceKobo ? ` · ${formatPrice(p.priceKobo, p.pricingPeriod)}` : ''}
                  </p>
                  {p.status === 'REJECTED' && p.moderationNote && (
                    <p className="line-clamp-1 text-sm text-error">
                      Changes requested: {p.moderationNote}
                    </p>
                  )}
                  <p className="mt-auto flex gap-4 text-xs text-text-muted">
                    <span className="flex items-center gap-1">
                      <Eye aria-hidden className="size-3.5" /> {p.stats.views} views
                    </span>
                    <span className="flex items-center gap-1">
                      <Heart aria-hidden className="size-3.5" /> {p.stats.favorites} saves
                    </span>
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
