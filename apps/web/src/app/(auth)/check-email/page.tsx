import type { Metadata } from 'next';

import { AuthCard, TextLink } from '@/components/auth/auth-card';
import { CheckEmailAddress, CheckEmailResend } from '@/components/auth/check-email-details';

export const metadata: Metadata = { title: 'Check your email', robots: { index: false } };

/** The address comes from this tab's sessionStorage, never the URL (see lib/check-email). */
export default function CheckEmailPage() {
  return (
    <AuthCard
      title="Check your email"
      description={
        <>
          We sent a verification link to <CheckEmailAddress />. Open it to activate your account.
          The link expires in 24 hours.
        </>
      }
      footer={
        <>
          Already verified? <TextLink href="/login">Sign in</TextLink>
        </>
      }
    >
      <p className="text-sm text-text-secondary">Didn’t get it? Check your spam folder, or:</p>
      <CheckEmailResend />
    </AuthCard>
  );
}
