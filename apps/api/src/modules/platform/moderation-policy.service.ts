import { Injectable } from '@nestjs/common';
import type { ModeratedListingType } from '@havenhub/shared';

import type { PlatformSettings, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type Db = Pick<PrismaService, 'platformSettings'> | Prisma.TransactionClient;

export const POLICY_COLUMN: Record<
  ModeratedListingType,
  keyof Pick<
    PlatformSettings,
    'reviewProperties' | 'reviewEvents' | 'reviewTours' | 'reviewHotels' | 'reviewCleaning'
  >
> = {
  PROPERTY: 'reviewProperties',
  EVENT: 'reviewEvents',
  TOUR: 'reviewTours',
  HOTEL: 'reviewHotels',
  CLEANING: 'reviewCleaning',
};

/**
 * Whether publishing a listing type needs admin review. Read inside the
 * caller's transaction at the moment of submission, so a policy change
 * applies to the very next submission on every instance (nothing cached).
 * Review is required when no settings row exists.
 */
@Injectable()
export class ModerationPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async requiresReview(type: ModeratedListingType, db: Db = this.prisma): Promise<boolean> {
    const row = await db.platformSettings.findUnique({ where: { id: 1 } });
    return row ? row[POLICY_COLUMN[type]] : true;
  }
}
