'use client';

import { Sparkles } from 'lucide-react';

/** Dispatched to open the floating assistant from elsewhere on the page. */
export const OPEN_ASSISTANT_EVENT = 'havenhub:open-assistant';

export function OpenAssistantButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT))}
      className={className}
    >
      <Sparkles aria-hidden className="size-4" />
      Ask HavenHub
    </button>
  );
}
