import type { AgentPropertyListItem } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { PromoCodeForm } from '@/components/promotions/promo-code-form';
import { serverApiData } from '@/lib/api/server';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'New promo code' };

export default async function NewPromoCodePage() {
  await requireUser('AGENT', '/agent/promotions/new');
  const properties = (await serverApiData<AgentPropertyListItem[]>('/agents/me/properties')) ?? [];
  const rentals = properties
    .filter((p) => p.listingType !== 'SALE' && p.status !== 'ARCHIVED')
    .map((p) => ({ id: p.id, title: p.title }));
  return (
    <>
      <Link href="/agent/promotions" className="text-sm text-text-secondary hover:text-text">
        ← Promotions
      </Link>
      <div className="mt-4">
        <PageHeader
          title="New promo code"
          description="Customers enter it when booking; it comes off your rent."
        />
      </div>
      <PromoCodeForm properties={rentals} />
    </>
  );
}
