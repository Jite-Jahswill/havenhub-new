import type { Metadata } from 'next';

import { AuthCard } from '@/components/auth/auth-card';
import { VerifyEmail } from '@/components/auth/email-token-forms';

export const metadata: Metadata = { title: 'Verify email', robots: { index: false } };

export default async function VerifyEmailPage({ searchParams }: PageProps<'/verify-email'>) {
  const { token } = await searchParams;
  return (
    <AuthCard title="Verify your email">
      <VerifyEmail token={typeof token === 'string' ? token : undefined} />
    </AuthCard>
  );
}
