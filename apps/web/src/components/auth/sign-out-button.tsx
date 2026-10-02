'use client';

import { Button } from '@havenhub/ui';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api/client';

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await api('POST', '/auth/logout');
    router.replace('/login');
    router.refresh();
  }

  return (
    <Button variant="ghost" size="sm" onClick={signOut} loading={pending} className={className}>
      {!pending && <LogOut aria-hidden className="size-4" />}
      Sign out
    </Button>
  );
}
