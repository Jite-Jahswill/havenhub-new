import type { Metadata } from 'next';

import { AuthCard } from '@/components/auth/auth-card';
import { ResetPasswordForm } from '@/components/auth/email-token-forms';
import { getPublicPolicies } from '@/lib/cms';

export const metadata: Metadata = { title: 'Choose a new password', robots: { index: false } };

export default async function ResetPasswordPage({ searchParams }: PageProps<'/reset-password'>) {
  const { token } = await searchParams;
  return (
    <AuthCard
      title="Choose a new password"
      description="You’ll be signed out of all other devices."
    >
      <ResetPasswordForm
        token={typeof token === 'string' ? token : undefined}
        passwordMinLength={(await getPublicPolicies()).passwordMinLength}
      />
    </AuthCard>
  );
}
