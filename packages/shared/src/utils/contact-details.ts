/**
 * Spots contact details in chat text so the off-platform warning can be shown.
 * Deliberately simple and on the side of warning: it never blocks or changes
 * a message, so an occasional false positive (a long number) is harmless.
 */

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i;
/** 10–15 digits, optionally starting with +, allowing spaces, dots, dashes and brackets between them. */
const PHONE = /(?<![\d+])\+?\(?\d(?:[\s().-]{0,2}\d){9,14}(?!\d)/;
const MESSAGING_LINK = /\b(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|t\.me)\//i;

export function containsContactDetails(text: string | null | undefined): boolean {
  if (!text) return false;
  return EMAIL.test(text) || PHONE.test(text) || MESSAGING_LINK.test(text);
}

/** Shown when chat messages contain contact details, unless admins set their own wording. */
export const DEFAULT_CHAT_CONTACT_WARNING =
  'Keep bookings and payments on HavenHub. Bookings, payments or agreements made outside ' +
  'HavenHub (by phone, email or other apps) are not protected, and HavenHub is not responsible ' +
  'for them.';
