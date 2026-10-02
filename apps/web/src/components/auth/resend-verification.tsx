'use client';

import { Button } from '@havenhub/ui';
import { useState } from 'react';

import { api } from '@/lib/api/client';

export function ResendVerification({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function resend() {
    setState('sending');
    const res = await api('POST', '/auth/resend-verification', { email });
    setState(res.success ? 'sent' : 'error');
  }

  if (!email) return null;
  if (state === 'sent')
    return <p className="mt-2 font-medium">A new verification link is on its way.</p>;
  return (
    <div className="mt-3">
      <Button size="sm" variant="secondary" onClick={resend} loading={state === 'sending'}>
        Resend verification email
      </Button>
      {state === 'error' && <p className="mt-2">Please wait a little before trying again.</p>}
    </div>
  );
}
