import { describe, expect, it } from 'vitest';

import { FieldEncryptionService, maskLast4 } from './field-encryption.service';

const service = new FieldEncryptionService({
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
});

describe('FieldEncryptionService', () => {
  it('round-trips plaintext', () => {
    const ciphertext = service.encrypt('12345678901');
    expect(ciphertext).not.toContain('12345678901');
    expect(service.decrypt(ciphertext)).toBe('12345678901');
  });

  it('uses a fresh IV for every encryption', () => {
    expect(service.encrypt('same')).not.toBe(service.encrypt('same'));
  });

  it('detects tampering', () => {
    const [v, iv, tag, data] = service.encrypt('12345678901').split('.');
    const tampered = [v, iv, tag, `${data!.slice(0, -2)}AA`].join('.');
    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('fails with a different key', () => {
    const other = new FieldEncryptionService({
      FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64'),
    });
    expect(() => other.decrypt(service.encrypt('secret'))).toThrow();
  });

  it('produces stable fingerprints that differ from ciphertext', () => {
    expect(service.fingerprint('12345678901')).toBe(service.fingerprint('12345678901'));
    expect(service.fingerprint('12345678901')).not.toBe(service.fingerprint('12345678902'));
  });

  it('masks all but the last four digits', () => {
    expect(maskLast4('8901')).toBe('•••••••8901');
    expect(maskLast4('8901', 10)).toBe('••••••8901');
    expect(maskLast4(null)).toBeNull();
  });
});
