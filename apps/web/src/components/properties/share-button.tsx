'use client';

import { cn } from '@havenhub/ui';
import { Check, Share2 } from 'lucide-react';
import { useState } from 'react';

export function ShareButton({ title, className }: { title: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // Cancelled, or unsupported target: fall back to copying.
      }
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={share}
      className={cn(
        'flex h-10 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium text-text hover:bg-surface-secondary',
        className,
      )}
    >
      {copied ? (
        <Check aria-hidden className="size-4 text-success" />
      ) : (
        <Share2 aria-hidden className="size-4" />
      )}
      <span aria-live="polite">{copied ? 'Link copied' : 'Share'}</span>
    </button>
  );
}
