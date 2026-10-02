import { Injectable } from '@nestjs/common';
import type {
  AdminAmenityView,
  AmenityView,
  CreateAmenityInput,
  UpdateAmenityInput,
} from '@havenhub/shared';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { Prisma, type Amenity } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toAmenityView } from '../properties/property.mapper';
import { amenitySlug } from '../properties/slug';

/**
 * Admin-managed amenity catalogue. Amenities are deactivated rather than
 * deleted so existing listings keep a consistent history.
 */
@Injectable()
export class AmenitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listActive(): Promise<AmenityView[]> {
    const rows = await this.prisma.amenity.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toAmenityView);
  }

  async adminList(): Promise<AdminAmenityView[]> {
    const rows = await this.prisma.amenity.findMany({
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { properties: true } } },
    });
    return rows.map((row) => this.adminView(row, row._count.properties));
  }

  async create(
    actorId: string,
    input: CreateAmenityInput,
    meta: RequestMeta,
  ): Promise<AdminAmenityView> {
    const slug = amenitySlug(input.name);
    if (slug.length < 2) throw Errors.badRequest('Use letters or numbers in the amenity name.');
    try {
      const amenity = await this.prisma.amenity.create({
        data: {
          slug,
          name: input.name,
          category: input.category,
          icon: input.icon ?? null,
          sortOrder: input.sortOrder ?? 0,
        },
      });
      await this.audit.record({
        actorId,
        action: 'amenity.created',
        resourceType: 'amenity',
        resourceId: amenity.id,
        after: { name: amenity.name, category: amenity.category },
        meta,
      });
      return this.adminView(amenity, 0);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw Errors.conflict('An amenity with this name already exists.');
      }
      throw error;
    }
  }

  /** The slug stays fixed after creation so saved search links keep working. */
  async update(
    actorId: string,
    id: string,
    input: UpdateAmenityInput,
    meta: RequestMeta,
  ): Promise<AdminAmenityView> {
    const before = await this.prisma.amenity.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('Amenity');
    const amenity = await this.prisma.amenity.update({
      where: { id },
      data: input,
      include: { _count: { select: { properties: true } } },
    });
    await this.audit.record({
      actorId,
      action: 'amenity.updated',
      resourceType: 'amenity',
      resourceId: id,
      before: { name: before.name, isActive: before.isActive, category: before.category },
      after: { name: amenity.name, isActive: amenity.isActive, category: amenity.category },
      meta,
    });
    return this.adminView(amenity, amenity._count.properties);
  }

  private adminView(amenity: Amenity, propertyCount: number): AdminAmenityView {
    return {
      ...toAmenityView(amenity),
      isActive: amenity.isActive,
      sortOrder: amenity.sortOrder,
      propertyCount,
    };
  }
}
