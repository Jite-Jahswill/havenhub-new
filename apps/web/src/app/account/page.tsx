import { Card, CardBody } from '@havenhub/ui';
import type { Metadata } from 'next';

import { ProfileForm } from '@/components/account/profile-form';
import { PageHeader } from '@/components/dashboard/dashboard-shell';
import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Profile' };

export default async function AccountProfilePage() {
  const user = await requireUser('CUSTOMER', '/account');
  return (
    <>
      <PageHeader title="Profile" description="Your personal details." />
      <Card>
        <CardBody>
          <ProfileForm user={user} />
        </CardBody>
      </Card>
    </>
  );
}
