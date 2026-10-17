'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Keeps what the user is reading in place when the element behind `ref`,
 * sitting above it on the page, grows or shrinks — e.g. upload controls
 * disappearing once a listing is sent for review. The browser's own scroll
 * anchoring misses this next to sticky sidebars, so the page jumped.
 * ResizeObserver runs after layout and before paint, so no jump is seen.
 */
export function useKeepScrollBelow(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let height = el.offsetHeight;
    const observer = new ResizeObserver(() => {
      const next = el.offsetHeight;
      const delta = next - height;
      height = next;
      // Only when the reader is below the element, not looking at it.
      if (delta !== 0 && el.getBoundingClientRect().bottom < window.innerHeight / 2) {
        window.scrollBy({ top: delta, behavior: 'instant' });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}
