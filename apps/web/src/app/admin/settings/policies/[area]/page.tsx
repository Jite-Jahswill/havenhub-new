import {
  POLICY_AREA_META,
  POLICY_AREAS,
  type PlatformPoliciesView,
  type PolicyArea,
} from '@havenhub/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { NoAccess } from '@/components/admin/no-access';
import { PolicyForm } from '@/components/admin/platform/policy-form';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { serverApi } from '@/lib/api/server';
import { requireUser } from '@/lib/session';

const isArea = (value: string): value is PolicyArea =>
  (POLICY_AREAS as readonly string[]).includes(value);

export async function generateMetadata({
  params,
}: PageProps<'/admin/settings/policies/[area]'>): Promise<Metadata> {
  const { area } = await params;
  return { title: isArea(area) ? POLICY_AREA_META[area].title : 'Settings' };
}

export default async function PolicyAreaPage({
  params,
}: PageProps<'/admin/settings/policies/[area]'>) {
  const { area } = await params;
  if (!isArea(area)) notFound();
  await requireUser('ADMIN', `/admin/settings/policies/${area}`);
  const res = await serverApi<PlatformPoliciesView>('/admin/settings/policies');
  const meta = POLICY_AREA_META[area];
  return (
    <>
      <Link href="/admin/settings" className="text-sm text-text-secondary hover:text-text">
        ← Settings
      </Link>
      <div className="mt-4">
        <PageHeader title={meta.title} description={meta.description} />
      </div>
      {res.success ? <PolicyForm area={area} values={res.data.policies[area]} /> : <NoAccess />}
    </>
  );
}
