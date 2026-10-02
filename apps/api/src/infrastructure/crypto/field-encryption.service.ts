import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';

const ALGORITHM = 'aes-256-gcm';
const KEY_VERSION = 'v1';

/**
 * Encrypts sensitive fields (NIN, bank account numbers) at rest with
 * AES-256-GCM. Ciphertext format: `v1.<iv>.<authTag>.<ciphertext>` (base64url),
 * so keys can be rotated later by introducing `v2` alongside `v1`.
 *
 * Separate sub-keys are derived (HKDF) for encryption and for fingerprints, so
 * the HMAC fingerprint used for duplicate detection never reuses the
 * encryption key.
 */
@Injectable()
export class FieldEncryptionService {
  private readonly encryptionKey: Buffer;
  private readonly fingerprintKey: Buffer;

  constructor(@Inject(ENV) env: Pick<Env, 'FIELD_ENCRYPTION_KEY'>) {
    const master = Buffer.from(env.FIELD_ENCRYPTION_KEY, 'base64');
    this.encryptionKey = Buffer.from(hkdfSync('sha256', master, '', 'havenhub:field-enc:v1', 32));
    this.fingerprintKey = Buffer.from(hkdfSync('sha256', master, '', 'havenhub:field-fp:v1', 32));
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [KEY_VERSION, iv, tag, ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  decrypt(payload: string): string {
    const [version, iv, tag, ciphertext] = payload.split('.');
    if (version !== KEY_VERSION || !iv || !tag || !ciphertext) {
      throw new Error('Unsupported ciphertext format');
    }
    const decipher = createDecipheriv(ALGORITHM, this.encryptionKey, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Deterministic keyed hash, for uniqueness checks without decrypting. */
  fingerprint(value: string): string {
    return createHmac('sha256', this.fingerprintKey).update(value).digest('hex');
  }
}

/** "•••••••1234" — the only form in which sensitive numbers leave the API. */
export const maskLast4 = (last4: string | null | undefined, length = 11): string | null =>
  last4 ? `${'•'.repeat(Math.max(length - 4, 3))}${last4}` : null;
