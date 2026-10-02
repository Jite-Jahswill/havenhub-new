import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type {
  AdminVacationZoneListItem,
  AdminVacationZoneView,
  Paginated,
  VacationZoneCard,
  VacationZoneDetail,
  adminListVacationZonesQuerySchema,
  createVacationZoneSchema,
  setZoneExperiencesSchema,
  updateVacationZoneSchema,
  vacationZoneListQuerySchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { paginate } from '../../common/http/response';
import type { Prisma, VacationZone } from '../../generated/prisma/client';
import { ImageProcessor } from '../../infrastructure/media/image-processor.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { num } from '../properties/property.mapper';
import { amenitySlug } from '../properties/slug';
import { validationError } from './agent-experiences.service';
import { toExperienceCard } from './experience.mapper';
import { PUBLIC_EXPERIENCE_WHERE, experienceCardSelect } from './experience.selects';

type Out<T extends z.ZodType> = z.output<T>;

/** Kinds an administrator can feature in a destination (§23: tours and hotels). */
const CURATABLE = ['TOUR', 'HOTEL'] as const;

/**
 * Vacation zones (§23): admin-managed destination pages. Their price range
 * is indicative text for visitors, never a charge. Featured tours and hotels
 * are shown only while they are publicly visible.
 */
@Injectable()
export class VacationZonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly images: ImageProcessor,
    private readonly audit: AuditService,
  ) {}

  // ── Public ──

  async list(query: Out<typeof vacationZoneListQuerySchema>): Promise<Paginated<VacationZoneCard>> {
    const where: Prisma.VacationZoneWhereInput = {
      published: true,
      ...(query.state ? { state: { equals: query.state, mode: 'insensitive' } } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.vacationZone.count({ where }),
      this.prisma.vacationZone.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return paginate(
      rows.map((r) => this.card(r)),
      query.page,
      query.pageSize,
      total,
    );
  }

  async detail(slug: string): Promise<VacationZoneDetail> {
    const zone = await this.prisma.vacationZone.findFirst({ where: { slug, published: true } });
    if (!zone) throw Errors.notFound('Destination');
    const links = await this.prisma.vacationZoneExperience.findMany({
      where: { zoneId: zone.id, experience: PUBLIC_EXPERIENCE_WHERE },
      orderBy: { sortOrder: 'asc' },
      select: { experience: { select: experienceCardSelect(new Date()) } },
    });
    return {
      ...this.detailFields(zone),
      experiences: links.map((l) => toExperienceCard(l.experience, this.storage)),
    };
  }

  // ── Admin ──

  async adminList(
    query: Out<typeof adminListVacationZonesQuerySchema>,
  ): Promise<Paginated<AdminVacationZoneListItem>> {
    const where: Prisma.VacationZoneWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { state: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.vacationZone.count({ where }),
      this.prisma.vacationZone.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { _count: { select: { experiences: true } } },
      }),
    ]);
    return paginate(
      rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        state: r.state,
        published: r.published,
        coverImage: r.coverThumbKey ? { thumbnailUrl: this.storage.url(r.coverThumbKey) } : null,
        experienceCount: r._count.experiences,
        updatedAt: r.updatedAt.toISOString(),
      })),
      query.page,
      query.pageSize,
      total,
    );
  }

  async adminGet(id: string): Promise<AdminVacationZoneView> {
    const zone = await this.prisma.vacationZone.findUnique({ where: { id } });
    if (!zone) throw Errors.notFound('Destination');
    const [links, visible] = await Promise.all([
      this.prisma.vacationZoneExperience.findMany({
        where: { zoneId: id },
        orderBy: { sortOrder: 'asc' },
        select: {
          experience: {
            select: { id: true, slug: true, kind: true, title: true, status: true },
          },
        },
      }),
      this.prisma.vacationZoneExperience.findMany({
        where: { zoneId: id, experience: PUBLIC_EXPERIENCE_WHERE },
        select: { experienceId: true },
      }),
    ]);
    const isPublic = new Set(visible.map((v) => v.experienceId));
    return {
      ...this.detailFields(zone),
      published: zone.published,
      sortOrder: zone.sortOrder,
      experiences: links.map((l) => ({ ...l.experience, public: isPublic.has(l.experience.id) })),
      createdAt: zone.createdAt.toISOString(),
      updatedAt: zone.updatedAt.toISOString(),
    };
  }

  async create(
    actorId: string,
    input: Out<typeof createVacationZoneSchema>,
    meta: RequestMeta,
  ): Promise<AdminVacationZoneView> {
    const zone = await this.prisma.$transaction(async (tx) => {
      const created = await tx.vacationZone.create({
        data: {
          ...zoneColumns(input),
          name: input.name,
          slug: zoneSlug(input.name),
          createdById: actorId,
        },
      });
      await this.audit.record(
        {
          actorId,
          action: 'vacation_zone.created',
          resourceType: 'vacation_zone',
          resourceId: created.id,
          meta,
        },
        tx,
      );
      return created;
    });
    return this.adminGet(zone.id);
  }

  async update(
    actorId: string,
    id: string,
    input: Out<typeof updateVacationZoneSchema>,
    meta: RequestMeta,
  ): Promise<AdminVacationZoneView> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.vacationZone.findUnique({ where: { id } });
      if (!current) throw Errors.notFound('Destination');
      const data = zoneColumns(input);
      // The merged range must stay ordered, not just the patch.
      const min =
        input.priceRangeMinKobo !== undefined
          ? input.priceRangeMinKobo
          : num(current.priceRangeMinKobo);
      const max =
        input.priceRangeMaxKobo !== undefined
          ? input.priceRangeMaxKobo
          : num(current.priceRangeMaxKobo);
      if (min !== null && max !== null && min > max) {
        throw validationError('priceRangeMaxKobo', 'The highest price must be at least the lowest');
      }
      await tx.vacationZone.update({ where: { id }, data });
      await this.audit.record(
        {
          actorId,
          action: 'vacation_zone.updated',
          resourceType: 'vacation_zone',
          resourceId: id,
          before: { published: current.published },
          after: { fields: Object.keys(input), published: input.published ?? current.published },
          meta,
        },
        tx,
      );
    });
    return this.adminGet(id);
  }

  async remove(actorId: string, id: string, meta: RequestMeta): Promise<{ deleted: true }> {
    const zone = await this.prisma.$transaction(async (tx) => {
      const current = await tx.vacationZone.findUnique({ where: { id } });
      if (!current) throw Errors.notFound('Destination');
      await tx.vacationZone.delete({ where: { id } });
      await this.audit.record(
        {
          actorId,
          action: 'vacation_zone.deleted',
          resourceType: 'vacation_zone',
          resourceId: id,
          before: { name: current.name, slug: current.slug },
          meta,
        },
        tx,
      );
      return current;
    });
    await this.deleteCover(zone);
    return { deleted: true };
  }

  async setCover(
    actorId: string,
    id: string,
    file: Buffer,
    meta: RequestMeta,
  ): Promise<AdminVacationZoneView> {
    const exists = await this.prisma.vacationZone.count({ where: { id } });
    if (!exists) throw Errors.notFound('Destination');
    const { large, thumbnail } = await this.images.listingRenditions(file);
    const largeKey = this.storage.newKey(`zones/${id}`, 'lg');
    const thumbKey = this.storage.newKey(`zones/${id}`, 'sm');
    await Promise.all([
      this.storage.put(largeKey, large.buffer, 'image/webp'),
      this.storage.put(thumbKey, thumbnail.buffer, 'image/webp'),
    ]);
    let previous: VacationZone | null = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM vacation_zones WHERE id = ${id}::uuid FOR UPDATE`;
        previous = await tx.vacationZone.findUnique({ where: { id } });
        if (!previous) throw Errors.notFound('Destination');
        await tx.vacationZone.update({
          where: { id },
          data: { coverKey: largeKey, coverThumbKey: thumbKey, coverBytes: large.buffer.length },
        });
        await this.audit.record(
          {
            actorId,
            action: 'vacation_zone.cover_set',
            resourceType: 'vacation_zone',
            resourceId: id,
            meta,
          },
          tx,
        );
      });
    } catch (error) {
      await this.storage.deleteQuietly(largeKey, thumbKey);
      throw error;
    }
    if (previous) await this.deleteCover(previous);
    return this.adminGet(id);
  }

  /** Replaces the featured tours and hotels. Each must be public when chosen. */
  async setExperiences(
    actorId: string,
    id: string,
    input: Out<typeof setZoneExperiencesSchema>,
    meta: RequestMeta,
  ): Promise<AdminVacationZoneView> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vacation_zones WHERE id = ${id}::uuid FOR UPDATE`;
      const zone = await tx.vacationZone.findUnique({ where: { id }, select: { id: true } });
      if (!zone) throw Errors.notFound('Destination');
      if (input.experienceIds.length) {
        const found = await tx.experience.count({
          where: {
            ...PUBLIC_EXPERIENCE_WHERE,
            id: { in: input.experienceIds },
            kind: { in: [...CURATABLE] },
          },
        });
        if (found !== input.experienceIds.length) {
          throw validationError('experienceIds', 'Choose published tours and hotels only');
        }
      }
      await tx.vacationZoneExperience.deleteMany({ where: { zoneId: id } });
      if (input.experienceIds.length) {
        await tx.vacationZoneExperience.createMany({
          data: input.experienceIds.map((experienceId, sortOrder) => ({
            zoneId: id,
            experienceId,
            sortOrder,
          })),
        });
      }
      await this.audit.record(
        {
          actorId,
          action: 'vacation_zone.experiences_set',
          resourceType: 'vacation_zone',
          resourceId: id,
          after: { experienceIds: input.experienceIds },
          meta,
        },
        tx,
      );
    });
    return this.adminGet(id);
  }

  private async deleteCover(zone: Pick<VacationZone, 'coverKey' | 'coverThumbKey'>) {
    const keys = [zone.coverKey, zone.coverThumbKey].filter((k): k is string => Boolean(k));
    if (keys.length) await this.storage.deleteQuietly(...keys);
  }

  private card(zone: VacationZone): VacationZoneCard {
    return {
      id: zone.id,
      slug: zone.slug,
      name: zone.name,
      state: zone.state,
      summary: zone.description ? excerpt(zone.description, 200) : null,
      coverImage:
        zone.coverKey && zone.coverThumbKey
          ? {
              url: this.storage.url(zone.coverKey),
              thumbnailUrl: this.storage.url(zone.coverThumbKey),
            }
          : null,
      priceRangeMinKobo: num(zone.priceRangeMinKobo),
      priceRangeMaxKobo: num(zone.priceRangeMaxKobo),
    };
  }

  private detailFields(zone: VacationZone) {
    return {
      ...this.card(zone),
      description: zone.description,
      accommodation: zone.accommodation,
      activities: zone.activities,
      offers: zone.offers,
      hospitality: zone.hospitality,
      nearbyAttractions: zone.nearbyAttractions,
    };
  }
}

function zoneColumns(
  input: Partial<Out<typeof updateVacationZoneSchema>>,
): Prisma.VacationZoneUncheckedUpdateInput & Prisma.VacationZoneUncheckedCreateInput {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    data[key] =
      key === 'priceRangeMinKobo' || key === 'priceRangeMaxKobo'
        ? value === null
          ? null
          : BigInt(value as number)
        : value;
  }
  return data as Prisma.VacationZoneUncheckedUpdateInput & Prisma.VacationZoneUncheckedCreateInput;
}

/** "Obudu Mountain Resort" → "obudu-mountain-resort-a1b2c3" (fits the 80-character column). */
function zoneSlug(name: string): string {
  const base = amenitySlug(name).slice(0, 72).replace(/-+$/, '');
  return `${base || 'destination'}-${randomBytes(3).toString('hex')}`;
}

function excerpt(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}
