import { Injectable } from '@nestjs/common';

import { VerificationTokenType, type Prisma } from '../../generated/prisma/client';
import { generateSecret, sha256 } from '../../infrastructure/crypto/tokens';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export const TOKEN_TTL_MINUTES: Record<VerificationTokenType, number> = {
  EMAIL_VERIFICATION: 24 * 60,
  PASSWORD_RESET: 60,
};

/**
 * Single-use, expiring tokens delivered by email. Only SHA-256 hashes are
 * stored; issuing a new token invalidates earlier unused ones of the same type.
 */
@Injectable()
export class VerificationTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(userId: string, type: VerificationTokenType): Promise<string> {
    const token = generateSecret();
    await this.prisma.$transaction([
      this.prisma.verificationToken.updateMany({
        where: { userId, type, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.verificationToken.create({
        data: {
          userId,
          type,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES[type] * 60_000),
        },
      }),
    ]);
    return token;
  }

  /**
   * Atomically marks a valid token as used and returns its user id, or
   * `null` if the token is unknown, expired, already used or of another type.
   */
  async consume(
    token: string,
    type: VerificationTokenType,
    tx: Prisma.TransactionClient,
  ): Promise<string | null> {
    const tokenHash = sha256(token);
    const record = await tx.verificationToken.findUnique({ where: { tokenHash } });
    if (!record || record.type !== type || record.usedAt || record.expiresAt <= new Date()) {
      return null;
    }
    const { count } = await tx.verificationToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1 ? record.userId : null;
  }
}
