import { Injectable } from '@nestjs/common';
import type {
  AdminTestimonialView,
  createTestimonialSchema,
  updateTestimonialSchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import type { CmsMedia, Testimonial } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { CmsCacheService } from './cms-cache.service';
import { assertMediaExists, toCmsImage } from './cms-helpers';

type Out<T extends z.ZodType> = z.output<T>;

/** Admin-managed quotes for the homepage Testimonials section. */
@Injectable()
export class TestimonialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly cache: CmsCacheService,
  ) {}

  async list(): Promise<AdminTestimonialView[]> {
    const rows = await this.prisma.testimonial.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { photo: true },
    });
    return rows.map((r) => this.view(r));
  }

  async create(actorId: string, input: Out<typeof createTestimonialSchema>, meta: RequestMeta) {
    const row = await this.prisma.$transaction(async (tx) => {
      await assertMediaExists(tx, input.photoId, 'photoId');
      const created = await tx.testimonial.create({
        data: {
          quote: input.quote,
          authorName: input.authorName,
          authorRole: input.authorRole ?? null,
          photoId: input.photoId ?? null,
          published: input.published ?? false,
          sortOrder: input.sortOrder ?? 0,
        },
        include: { photo: true },
      });
      await this.audit.record(
        {
          actorId,
          action: 'cms.testimonial.created',
          resourceType: 'testimonial',
          resourceId: created.id,
          meta,
        },
        tx,
      );
      return created;
    });
    await this.cache.invalidate();
    return this.view(row);
  }

  async update(
    actorId: string,
    id: string,
    input: Out<typeof updateTestimonialSchema>,
    meta: RequestMeta,
  ) {
    const row = await this.prisma.$transaction(async (tx) => {
      if (!(await tx.testimonial.count({ where: { id } }))) throw Errors.notFound('Testimonial');
      await assertMediaExists(tx, input.photoId, 'photoId');
      const updated = await tx.testimonial.update({
        where: { id },
        data: input,
        include: { photo: true },
      });
      await this.audit.record(
        {
          actorId,
          action: 'cms.testimonial.updated',
          resourceType: 'testimonial',
          resourceId: id,
          after: { fields: Object.keys(input) },
          meta,
        },
        tx,
      );
      return updated;
    });
    await this.cache.invalidate();
    return this.view(row);
  }

  async remove(actorId: string, id: string, meta: RequestMeta): Promise<{ deleted: true }> {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.testimonial.findUnique({ where: { id } });
      if (!row) throw Errors.notFound('Testimonial');
      await tx.testimonial.delete({ where: { id } });
      await this.audit.record(
        {
          actorId,
          action: 'cms.testimonial.deleted',
          resourceType: 'testimonial',
          resourceId: id,
          before: { authorName: row.authorName, quote: row.quote },
          meta,
        },
        tx,
      );
    });
    await this.cache.invalidate();
    return { deleted: true };
  }

  private view(row: Testimonial & { photo: CmsMedia | null }): AdminTestimonialView {
    return {
      id: row.id,
      quote: row.quote,
      authorName: row.authorName,
      authorRole: row.authorRole,
      photo: row.photo ? toCmsImage(row.photo, this.storage) : null,
      published: row.published,
      sortOrder: row.sortOrder,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
