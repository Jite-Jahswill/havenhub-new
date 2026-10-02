import type { Metadata } from 'next';

import { AuthCard, TextLink } from '@/components/auth/auth-card';
import { ResendVerification } from '@/components/auth/resend-verification';

export const metadata: Metadata = { title: 'Check your email', robots: { index: false } };

export default async function CheckEmailPage({ searchParams }: PageProps<'/check-email'>) {
  const { email } = await searchParams;
  const address = typeof email === 'string' ? email : '';
  return (
    <AuthCard
      title="Check your email"
      description={
        <>
          We sent a verification link to{' '}
          {address ? <strong className="text-text">{address}</strong> : 'your inbox'}. Open it to
          activate your account. The link expires in 24 hours.
        </>
      }
      footer={
        <>
          Already verified? <TextLink href="/login">Sign in</TextLink>
        </>
      }
    >
      <p className="text-sm text-text-secondary">Didn’t get it? Check your spam folder, or:</p>
      <ResendVerification email={address} />
    </AuthCard>
  );
}
