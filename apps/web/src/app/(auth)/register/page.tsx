import type { Metadata } from 'next';

import { AuthCard, TextLink } from '@/components/auth/auth-card';
import { RegisterForm } from '@/components/auth/register-form';
import { getPublicPolicies } from '@/lib/cms';

export const metadata: Metadata = { title: 'Create an account' };

export default async function RegisterPage() {
  return (
    <AuthCard
      title="Create your account"
      description="Find places to live, stay and explore across Nigeria."
      footer={
        <div className="flex flex-col gap-2">
          <span>
            Already have an account? <TextLink href="/login">Sign in</TextLink>
          </span>
          <span>
            Own or manage property? <TextLink href="/register/agent">Join as an agent</TextLink>
          </span>
        </div>
      }
    >
      <RegisterForm
        variant="customer"
        passwordMinLength={(await getPublicPolicies()).passwordMinLength}
      />
    </AuthCard>
  );
}
