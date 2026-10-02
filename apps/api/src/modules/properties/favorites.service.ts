import { Injectable } from '@nestjs/common';
import type { Paginated, PropertyCard } from '@havenhub/shared';

import { Errors } from '../../common/errors/app.exception';
import { paginate } from '../../common/http/response';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { toPropertyCard } from './property.mapper';
import { PROPERTY_CARD_SELECT, PUBLIC_PROPERTY_WHERE } from './property.selects';

/**
 * A customer's saved properties. The user id always comes from the session,
 * so there is no way to address another customer's favourites.
 */
@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Only still-public listings are shown; hidden ones reappear if republished. */
  async list(userId: string, page: number, pageSize: number): Promise<Paginated<PropertyCard>> {
    const where = { userId, property: PUBLIC_PROPERTY_WHERE };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.propertyFavorite.count({ where }),
      this.prisma.propertyFavorite.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { property: { select: PROPERTY_CARD_SELECT } },
      }),
    ]);
    return paginate(
      rows.map((r) => toPropertyCard(r.property, this.storage)),
      page,
      pageSize,
      total,
    );
  }

  /** Idempotent. Only public listings can be favourited. */
  async add(userId: string, propertyId: string): Promise<void> {
    const visible = await this.prisma.property.count({
      where: { ...PUBLIC_PROPERTY_WHERE, id: propertyId },
    });
    if (!visible) throw Errors.notFound('Property');
    await this.prisma.propertyFavorite.createMany({
      data: [{ userId, propertyId }],
      skipDuplicates: true,
    });
  }

  /** Idempotent, and scoped to the caller. */
  async remove(userId: string, propertyId: string): Promise<void> {
    await this.prisma.propertyFavorite.deleteMany({ where: { userId, propertyId } });
  }
}
