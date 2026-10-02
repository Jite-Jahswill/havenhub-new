import type { AmenityView } from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PropertyForm } from '@/components/agent-properties/property-form';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApiData } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Add property' };

export default async function NewPropertyPage() {
  const amenities = (await serverApiData<AmenityView[]>('/amenities')) ?? [];
  return (
    <>
      <Link href="/agent/properties" className="text-sm text-text-secondary hover:text-text">
        ← Properties
      </Link>
      <div className="mt-4">
        <PageHeader
          title="Add a property"
          description="Start with the basics. You’ll add photos on the next step."
        />
      </div>
      <PropertyForm amenities={amenities} />
    </>
  );
}
