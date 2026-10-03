import { buttonClasses } from '@havenhub/ui';
import { MessageSquare } from 'lucide-react';
import Link from 'next/link';

import { StartConversationButton } from '@/components/chat/start-conversation-button';
import { getCurrentUser } from '@/lib/session';

/**
 * "Contact support": opens (or creates) the visitor's support conversation
 * — the Phase 5 chat, SUPPORT context. Guests sign in first; admins use the
 * support queue instead.
 */
export async function SupportEntry({ email }: { email: string | null }) {
  const user = await getCurrentUser();
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-6 shadow-card">
      <h2 className="text-lg font-semibold text-text">Still need help?</h2>
      <p className="text-sm text-text-secondary">
        Message our support team and we’ll reply in your HavenHub messages.
      </p>
      {!user ? (
        <Link
          href="/login?next=%2Fhelp"
          className={buttonClasses({ className: 'w-full sm:w-auto' })}
        >
          <MessageSquare aria-hidden className="size-4" /> Sign in to contact support
        </Link>
      ) : user.accountType === 'ADMIN' ? (
        <Link
          href="/admin/support"
          className={buttonClasses({ variant: 'secondary', className: 'w-full sm:w-auto' })}
        >
          Open the support queue
        </Link>
      ) : (
        <div className="sm:max-w-xs">
          <StartConversationButton
            context={{ contextType: 'SUPPORT' }}
            area={user.accountType === 'AGENT' ? 'agent' : 'account'}
            label="Contact support"
            variant="primary"
          />
        </div>
      )}
      {email && (
        <p className="text-sm text-text-secondary">
          Or email{' '}
          <a href={`mailto:${email}`} className="font-medium text-primary-text underline">
            {email}
          </a>
        </p>
      )}
    </div>
  );
}
