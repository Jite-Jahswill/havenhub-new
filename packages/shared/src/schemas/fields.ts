import { z } from 'zod';

/** Reusable field schemas. Inputs are trimmed and normalised here, once. */

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .pipe(z.email('Enter a valid email address'));

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** New passwords: length-based policy (NIST 800-63B), no composition rules. */
export const newPasswordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

/** Existing passwords are never re-validated against policy, only bounded. */
export const passwordField = z
  .string()
  .min(1, 'Enter your password')
  .max(PASSWORD_MAX_LENGTH, 'Password is too long');

export const fullNameField = z
  .string()
  .trim()
  .min(2, 'Enter your full name')
  .max(120, 'Name is too long');

/**
 * Nigerian phone numbers, normalised to E.164 (+234XXXXXXXXXX).
 * Accepts 0803…, 803…, 234803… and +234803…, with spaces or dashes.
 */
export const nigerianPhoneField = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .refine((value) => /^(\+?234|0)?[789][01]\d{8}$/.test(value), {
    message: 'Enter a valid Nigerian phone number',
  })
  .transform((value) => `+234${value.slice(-10)}`);

/** National Identification Number: exactly 11 digits. */
export const ninField = z
  .string()
  .trim()
  .regex(/^\d{11}$/, 'NIN must be exactly 11 digits');

/** NUBAN bank account number: exactly 10 digits. */
export const nubanField = z
  .string()
  .trim()
  .regex(/^\d{10}$/, 'Account number must be exactly 10 digits');

/** Opaque single-use tokens delivered by email. */
export const emailTokenField = z.string().trim().min(20).max(200);

export const uuidField = z.uuid();
