'use client';

import { containsContactDetails } from '@havenhub/shared';
import { cn } from '@havenhub/ui';
import { ShieldAlert } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';

/** The admins' notice about dealing outside HavenHub; null = switched off. */
const ContactWarningContext = createContext<string | null>(null);

export function ContactWarningProvider({
  warning,
  children,
}: {
  warning: string | null;
  children: ReactNode;
}) {
  return <ContactWarningContext value={warning}>{children}</ContactWarningContext>;
}

/**
 * Shown under messages (to both people) and above the composer while typing
 * when the text contains a phone number, email or messaging link. It warns
 * only: the message is never blocked or changed.
 */
export function ContactWarning({ text, className }: { text: string | null; className?: string }) {
  const warning = useContext(ContactWarningContext);
  if (!warning || !containsContactDetails(text)) return null;
  return (
    <p
      role="note"
      className={cn(
        'flex items-start gap-2 rounded-lg bg-warning-subtle px-3 py-2 text-xs text-text',
        className,
      )}
    >
      <ShieldAlert aria-hidden className="mt-px size-4 shrink-0 text-warning" />
      <span>{warning}</span>
    </p>
  );
}
