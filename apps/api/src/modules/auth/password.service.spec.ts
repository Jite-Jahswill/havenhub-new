import { describe, expect, it } from 'vitest';

import { PasswordService } from './password.service';

const service = new PasswordService();

describe('PasswordService', () => {
  it('hashes with argon2id and verifies', async () => {
    const hash = await service.hash('correct horse battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('correct horse battery');
    expect(await service.verify(hash, 'correct horse battery')).toBe(true);
    expect(await service.verify(hash, 'wrong password')).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await service.hash('same password')).not.toBe(await service.hash('same password'));
  });

  it('returns false for malformed hashes instead of throwing', async () => {
    expect(await service.verify('not-a-hash', 'anything')).toBe(false);
  });

  it('dummy verification always fails', async () => {
    expect(await service.verifyDummy('anything')).toBe(false);
  });
});
