import type { Metadata } from 'next';

import { AuthCard, TextLink } from '@/components/auth/auth-card';
import { RequestEmailForm } from '@/components/auth/email-token-forms';

export const metadata: Metadata = { title: 'Reset your password' };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email and we’ll send you a link to choose a new password."
      footer={
        <>
          Remembered it? <TextLink href="/login">Sign in</TextLink>
        </>
      }
    >
      <RequestEmailForm
        endpoint="/auth/forgot-password"
        submitLabel="Send reset link"
        doneMessage="If an account exists for that email, a reset link is on its way. It expires in 60 minutes."
      />
    </AuthCard>
  );
}
