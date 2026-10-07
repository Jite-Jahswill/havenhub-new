'use client';

import { popupEligible, type AccountType, type PublicPopupView } from '@havenhub/shared';
import { X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import { alreadySeen, browserStores, remember, shownThisVisit } from '@/lib/popup-frequency';

import { PopupContent } from './popup-content';

function track(id: string, type: 'VIEW' | 'CLICK' | 'DISMISS') {
  void fetch(`/api/v1/popups/${id}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * Picks at most one pop-up for this page (highest priority among those for
 * this visitor, page and time that this browser has not dismissed) and shows
 * it after its delay, in a native modal dialog.
 */
export function PopupHost({
  popups,
  viewer,
}: {
  popups: PublicPopupView[];
  viewer: AccountType | null;
}) {
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [current, setCurrent] = useState<PublicPopupView | null>(null);

  useEffect(() => {
    const stores = browserStores();
    if (popups.length === 0 || shownThisVisit(stores)) return;
    const now = new Date();
    const next = popups.find(
      (p) => popupEligible(p, { pathname, viewer, now }) && !alreadySeen(p, stores, now.getTime()),
    );
    if (!next) return;
    const timer = setTimeout(() => {
      // Re-checked: another tab or an earlier page may have shown one meanwhile.
      if (shownThisVisit(stores)) return;
      remember(next, stores, Date.now());
      setCurrent(next);
      track(next.id, 'VIEW');
    }, next.delaySeconds * 1000);
    return () => clearTimeout(timer);
  }, [popups, pathname, viewer]);

  useEffect(() => {
    const d = dialog.current;
    if (current && d && !d.open) d.showModal();
  }, [current]);

  if (!current) return null;

  function close(type: 'CLICK' | 'DISMISS') {
    if (current) track(current.id, type);
    dialog.current?.close();
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={() => track(current.id, 'DISMISS')}
      onClose={() => setCurrent(null)}
      onClick={(e) => {
        // A click on the backdrop (the dialog itself, outside its content) closes it.
        if (e.target === e.currentTarget) close('DISMISS');
      }}
      className="m-auto w-[min(92vw,480px)] overflow-hidden rounded-card border border-border bg-surface p-0 text-text shadow-raised backdrop:bg-black/50"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={() => close('DISMISS')}
        className="absolute top-3 right-3 z-10 grid size-9 place-items-center rounded-full bg-surface/90 text-text shadow-card hover:bg-surface"
      >
        <X aria-hidden className="size-5" />
      </button>
      <PopupContent popup={current} titleId={titleId} onAction={() => close('CLICK')} />
    </dialog>
  );
}
