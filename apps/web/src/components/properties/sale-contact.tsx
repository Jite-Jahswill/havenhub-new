'use client';

import type { SaleContactView } from '@havenhub/shared';
import { Alert, Button, buttonClasses } from '@havenhub/ui';
import { Mail, Phone, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

import { api } from '@/lib/api/client';
import { useApiAction } from '@/lib/use-api-action';

/**
 * Contact for sale. The buyer reads and accepts HavenHub's notice about
 * dealing outside HavenHub; only then are the agent's details shown. Each
 * acceptance (with the exact wording) is recorded by the API.
 */
export function SaleContact({
  slug,
  notice,
  noticeHash,
  signedIn,
}: {
  slug: string;
  notice: string;
  noticeHash: string;
  signedIn: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [contact, setContact] = useState<SaleContactView | null>(null);
  const { pending, error, run } = useApiAction();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  if (!signedIn) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(`/properties/${slug}`)}`}
        className={buttonClasses({ className: 'w-full' })}
      >
        Sign in to contact the agent
      </Link>
    );
  }

  async function reveal() {
    const result = await run(() =>
      api<SaleContactView>('POST', `/properties/${slug}/sale-contact`, {
        accepted: true,
        disclaimerHash: noticeHash,
      }),
    );
    if (result) setContact(result);
  }

  if (contact) {
    return (
      <div className="flex flex-col gap-2 rounded-control border border-border p-4 text-sm">
        <p className="font-semibold text-text">{contact.agentName}</p>
        {contact.phone && (
          <a
            href={`tel:${contact.phone}`}
            className="flex items-center gap-2 text-text hover:underline"
          >
            <Phone aria-hidden className="size-4" /> {contact.phone}
          </a>
        )}
        <a
          href={`mailto:${contact.email}`}
          className="flex items-center gap-2 text-text hover:underline"
        >
          <Mail aria-hidden className="size-4" /> {contact.email}
        </a>
        <p className="text-xs text-text-muted">
          Any deal you make directly with the agent is outside HavenHub, as you accepted.
        </p>
      </div>
    );
  }

  return (
    <>
      <Button className="w-full" onClick={() => setOpen(true)} aria-haspopup="dialog">
        Contact the agent about buying
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        className="m-auto w-[min(92vw,520px)] rounded-card border border-border bg-surface p-0 text-text shadow-raised backdrop:bg-black/50"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <h2 id={titleId} className="font-semibold">
            Before you contact the agent
          </h2>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)}>
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="max-h-[45vh] overflow-y-auto rounded-control bg-surface-secondary p-4 text-sm whitespace-pre-line text-text-secondary">
            {notice}
          </div>
          <label className="flex items-start gap-3 text-sm text-text">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            I have read and accept this notice.
          </label>
          {error && <Alert tone="error">{error.message}</Alert>}
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!accepted}
              loading={pending}
              onClick={() => void reveal().then(() => setOpen(false))}
            >
              Show contact details
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
