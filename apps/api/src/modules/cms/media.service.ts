import { Injectable } from '@nestjs/common';
import type { CmsMediaView, Paginated } from '@havenhub/shared';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { paginate } from '../../common/http/response';
import type { CmsMedia, User } from '../../generated/prisma/client';
import { ImageProcessor } from '../../infrastructure/media/image-processor.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { CmsCacheService } from './cms-cache.service';
import { conflict, mediaUsage, toCmsImage } from './cms-helpers';

/**
 * The CMS media library: images re-encoded by the shared pipeline (EXIF
 * stripped, WebP) under public, unguessable `cms/` keys. An image still used
 * by content cannot be deleted.
 */
@Injectable()
export class CmsMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ImageProcessor,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly cache: CmsCacheService,
  ) {}

  async list(page: number, pageSize: number): Promise<Paginated<CmsMediaView>> {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.cmsMedia.count(),
      this.prisma.cmsMedia.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { uploadedBy: { select: { fullName: true } } },
      }),
    ]);
    return paginate(
      rows.map((r) => this.view(r)),
      page,
      pageSize,
      total,
    );
  }

  async upload(actorId: string, file: Buffer, meta: RequestMeta): Promise<CmsMediaView> {
    const { large, thumbnail } = await this.images.cmsRenditions(file);
    const largeKey = this.storage.newKey('cms/media', 'lg');
    const thumbKey = this.storage.newKey('cms/media', 'sm');
    await Promise.all([
      this.storage.put(largeKey, large.buffer, 'image/webp'),
      this.storage.put(thumbKey, thumbnail.buffer, 'image/webp'),
    ]);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.cmsMedia.create({
          data: {
            storageKey: largeKey,
            thumbnailKey: thumbKey,
            width: large.width,
            height: large.height,
            bytes: large.buffer.length,
            uploadedById: actorId,
          },
          include: { uploadedBy: { select: { fullName: true } } },
        });
        await this.audit.record(
          {
            actorId,
            action: 'cms.media.uploaded',
            resourceType: 'cms_media',
            resourceId: created.id,
            meta,
          },
          tx,
        );
        return created;
      });
      return this.view(row);
    } catch (error) {
      await this.storage.deleteQuietly(largeKey, thumbKey);
      throw error;
    }
  }

  async update(actorId: string, id: string, altText: string | null | undefined, meta: RequestMeta) {
    const row = await this.prisma.$transaction(async (tx) => {
      if (!(await tx.cmsMedia.count({ where: { id } }))) throw Errors.notFound('Image');
      const updated = await tx.cmsMedia.update({
        where: { id },
        data: { altText: altText ?? null },
        include: { uploadedBy: { select: { fullName: true } } },
      });
      await this.audit.record(
        { actorId, action: 'cms.media.updated', resourceType: 'cms_media', resourceId: id, meta },
        tx,
      );
      return updated;
    });
    await this.cache.invalidate();
    return this.view(row);
  }

  async remove(actorId: string, id: string, meta: RequestMeta): Promise<{ deleted: true }> {
    const removed = await this.prisma.$transaction(async (tx) => {
      // Locked so content cannot start using it between the check and the delete.
      await tx.$queryRaw`SELECT id FROM cms_media WHERE id = ${id}::uuid FOR UPDATE`;
      const media = await tx.cmsMedia.findUnique({ where: { id } });
      if (!media) throw Errors.notFound('Image');
      const usedBy = await mediaUsage(tx, media);
      if (usedBy.length) {
        throw conflict(`This image is still used by ${usedBy.join(', ')}. Remove it there first.`);
      }
      await tx.cmsMedia.delete({ where: { id } });
      await this.audit.record(
        {
          actorId,
          action: 'cms.media.deleted',
          resourceType: 'cms_media',
          resourceId: id,
          before: { storageKey: media.storageKey },
          meta,
        },
        tx,
      );
      return media;
    });
    await this.storage.deleteQuietly(removed.storageKey, removed.thumbnailKey);
    return { deleted: true };
  }

  private view(row: CmsMedia & { uploadedBy: Pick<User, 'fullName'> | null }): CmsMediaView {
    return {
      ...toCmsImage(row, this.storage),
      bytes: row.bytes,
      createdAt: row.createdAt.toISOString(),
      uploadedBy: row.uploadedBy?.fullName ?? null,
    };
  }
}
