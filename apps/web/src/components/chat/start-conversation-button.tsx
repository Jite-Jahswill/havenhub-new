'use client';

import type { ConversationSummary, StartConversationInput } from '@havenhub/shared';
import { Alert, Button, buttonClasses } from '@havenhub/ui';
import { MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { api } from '@/lib/api/client';
import { useApiAction } from '@/lib/use-api-action';

/** Opens (or creates) the conversation for a listing or booking. */
export function StartConversationButton({
  context,
  area,
  label,
  guestHref,
  variant = 'secondary',
}: {
  context: StartConversationInput;
  area: 'account' | 'agent';
  label: string;
  /** For signed-out visitors: where to sign in first. */
  guestHref?: string;
  variant?: 'primary' | 'secondary';
}) {
  const router = useRouter();
  const { pending, error, run } = useApiAction();

  if (guestHref) {
    return (
      <Link href={guestHref} className={buttonClasses({ variant, className: 'w-full' })}>
        <MessageSquare aria-hidden className="size-4" /> {label}
      </Link>
    );
  }

  async function open() {
    const conversation = await run(() =>
      api<ConversationSummary>('POST', '/conversations', context),
    );
    if (conversation) router.push(`/${area}/messages?c=${conversation.id}`);
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <Alert tone="error">{error.message}</Alert>}
      <Button variant={variant} onClick={open} loading={pending} className="w-full">
        <MessageSquare aria-hidden className="size-4" /> {label}
      </Button>
    </div>
  );
}
