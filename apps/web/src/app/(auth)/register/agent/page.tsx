import type { Metadata } from 'next';

import { AuthCard, TextLink } from '@/components/auth/auth-card';
import { RegisterForm } from '@/components/auth/register-form';
import { getPublicPolicies } from '@/lib/cms';

export const metadata: Metadata = { title: 'Join as an agent' };

export default async function RegisterAgentPage() {
  return (
    <AuthCard
      title="Join HavenHub as an agent"
      description="List properties, hotels, events, tours and services. Your first listing is free."
      footer={
        <>
          Looking for a place instead?{' '}
          <TextLink href="/register">Create a customer account</TextLink>
        </>
      }
    >
      <RegisterForm
        variant="agent"
        passwordMinLength={(await getPublicPolicies()).passwordMinLength}
      />
    </AuthCard>
  );
}
