/**
 * After registration the new address is shown on /check-email. It travels in
 * this tab's sessionStorage — never in the URL, where it would end up in
 * browser history, server and analytics logs, and referrers. It survives a
 * refresh of the tab; elsewhere the page falls back to "your inbox".
 */
export const CHECK_EMAIL_PATH = '/check-email';
const STORAGE_KEY = 'havenhub:check-email';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

const sessionStore = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null; // storage disabled (privacy modes)
  }
};

export function rememberPendingEmail(email: string, storage = sessionStore()): void {
  try {
    storage?.setItem(STORAGE_KEY, email);
  } catch {
    // Quota or privacy mode: the page shows the generic wording instead.
  }
}

export function pendingEmail(storage = sessionStore()): string | null {
  try {
    const value = storage?.getItem(STORAGE_KEY) ?? null;
    return value && value.includes('@') && value.length <= 254 ? value : null;
  } catch {
    return null;
  }
}
