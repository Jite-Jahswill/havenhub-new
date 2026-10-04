'use client';

import { useSyncExternalStore } from 'react';

import { pendingEmail } from '@/lib/check-email';

import { ResendVerification } from './resend-verification';

const noSubscription = () => () => {};

/**
 * The address being verified, from this tab's sessionStorage (never the URL).
 * Rendered as "your inbox" on the server, then filled in on the client.
 */
function usePendingEmail(): string | null {
  return useSyncExternalStore(
    noSubscription,
    () => pendingEmail(),
    () => null,
  );
}

export function CheckEmailAddress() {
  const email = usePendingEmail();
  return email ? <strong className="text-text">{email}</strong> : <>your inbox</>;
}

export function CheckEmailResend() {
  return <ResendVerification email={usePendingEmail() ?? ''} />;
}
