import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CHECK_EMAIL_PATH, pendingEmail, rememberPendingEmail } from './check-email';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

describe('check-email hand-off', () => {
  it('keeps the address out of the URL', () => {
    expect(CHECK_EMAIL_PATH).toBe('/check-email');
    expect(CHECK_EMAIL_PATH).not.toMatch(/[?#]/);
    // The registration form navigates to the bare path and stores the address instead.
    const form = readFileSync(
      fileURLToPath(new URL('../components/auth/register-form.tsx', import.meta.url)),
      'utf8',
    );
    expect(form).toContain('router.push(CHECK_EMAIL_PATH)');
    expect(form).toContain('rememberPendingEmail(input.email)');
    expect(form).not.toMatch(/check-email\?|email=\$\{/);
    // And the page no longer reads it from the query string.
    const page = readFileSync(
      fileURLToPath(new URL('../app/(auth)/check-email/page.tsx', import.meta.url)),
      'utf8',
    );
    expect(page).not.toMatch(/searchParams/);
  });

  it('round-trips the address through session storage', () => {
    const storage = memoryStorage();
    expect(pendingEmail(storage)).toBeNull();
    rememberPendingEmail('ada@example.com', storage);
    expect(pendingEmail(storage)).toBe('ada@example.com');
    expect([...storage.map.values()]).toEqual(['ada@example.com']);
  });

  it('degrades gracefully without storage or with junk values', () => {
    expect(pendingEmail(null)).toBeNull();
    expect(() => rememberPendingEmail('a@b.c', null)).not.toThrow();
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => rememberPendingEmail('a@b.c', throwing)).not.toThrow();
    expect(pendingEmail(throwing)).toBeNull();
    const storage = memoryStorage();
    rememberPendingEmail('not-an-email', storage);
    expect(pendingEmail(storage)).toBeNull();
  });
});
