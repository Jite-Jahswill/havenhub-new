import { Injectable } from '@nestjs/common';
import { Algorithm, hash, verify } from '@node-rs/argon2';

/**
 * Argon2id with OWASP-recommended parameters (19 MiB, 2 iterations, 1 lane).
 * The encoded hash stores its own parameters, so they can be raised later
 * without invalidating existing passwords.
 */
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /**
   * Performs a verification with the same cost as a real one. Used when the
   * account does not exist, so response timing does not reveal whether an
   * email address is registered.
   */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash('havenhub-timing-equaliser');
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
