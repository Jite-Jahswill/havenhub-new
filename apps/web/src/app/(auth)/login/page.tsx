import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AuthCard, TextLink } from '@/components/auth/auth-card';
import { LoginForm } from '@/components/auth/login-form';
import { DASHBOARD_PATH } from '@/lib/navigation';
import { getCurrentUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const user = await getCurrentUser();
  if (user) redirect(DASHBOARD_PATH[user.accountType]);
  const { next } = await searchParams;

  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to manage your stays, listings and bookings."
      footer={
        <>
          New to HavenHub? <TextLink href="/register">Create an account</TextLink>
        </>
      }
    >
      <LoginForm next={typeof next === 'string' ? next : undefined} />
    </AuthCard>
  );
}
