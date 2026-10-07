import type { PublicPopupView } from '@havenhub/shared';

/** The two browser stores; either may be missing or throw (private mode, blocked storage). */
export interface PopupStores {
  local: Pick<Storage, 'getItem' | 'setItem'> | null;
  session: Pick<Storage, 'getItem' | 'setItem'> | null;
}

const DAY_MS = 24 * 3600 * 1000;
/** One pop-up per visit (tab session), whatever else is eligible. */
export const SHOWN_THIS_VISIT = 'hh-popup:visit';
const seenKey = (id: string) => `hh-popup:${id}`;

const read = (store: PopupStores['local'], key: string) => {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
};
const write = (store: PopupStores['local'], key: string, value: string) => {
  try {
    store?.setItem(key, value);
  } catch {
    // Not remembered: at worst the visitor sees it again on a later visit.
  }
};

export function shownThisVisit(stores: PopupStores): boolean {
  return read(stores.session, SHOWN_THIS_VISIT) !== null;
}

/**
 * Whether this browser should not see `popup` again yet: ONCE until its
 * content changes (version), DAILY for 24 hours, EVERY_VISIT for this visit.
 */
export function alreadySeen(
  popup: Pick<PublicPopupView, 'id' | 'version' | 'frequency'>,
  stores: PopupStores,
  now: number,
): boolean {
  if (popup.frequency === 'EVERY_VISIT') return read(stores.session, seenKey(popup.id)) !== null;
  const stored = read(stores.local, seenKey(popup.id));
  if (!stored) return false;
  const [version, at] = stored.split('|');
  if (popup.frequency === 'ONCE') return version === popup.version;
  return now - Number(at) < DAY_MS;
}

export function remember(
  popup: Pick<PublicPopupView, 'id' | 'version' | 'frequency'>,
  stores: PopupStores,
  now: number,
): void {
  write(stores.session, SHOWN_THIS_VISIT, popup.id);
  if (popup.frequency === 'EVERY_VISIT') write(stores.session, seenKey(popup.id), '1');
  else write(stores.local, seenKey(popup.id), `${popup.version}|${now}`);
}

/** The real browser stores, or null where access throws. */
export function browserStores(): PopupStores {
  const get = (name: 'localStorage' | 'sessionStorage') => {
    try {
      return window[name];
    } catch {
      return null;
    }
  };
  return { local: get('localStorage'), session: get('sessionStorage') };
}
