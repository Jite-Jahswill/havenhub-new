import type { AdminAmenityView } from '@havenhub/shared';
import type { Metadata } from 'next';

import { AmenityManager } from '@/components/admin/amenity-manager';
import { NoAccess } from '@/components/admin/no-access';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Amenities' };

export default async function AdminAmenitiesPage() {
  await requireUser('ADMIN', '/admin/amenities');
  const res = await serverApi<AdminAmenityView[]>('/admin/amenities');
  return (
    <>
      <PageHeader
        title="Amenities"
        description="The catalogue agents choose from. Deactivate rather than delete so existing listings stay consistent."
      />
      {res.success ? <AmenityManager amenities={res.data} /> : <NoAccess />}
    </>
  );
}
