import { HttpStatus, Injectable } from '@nestjs/common';
import {
  EXPERIENCE_LIMITS,
  ErrorCode,
  ExperienceStatus,
  parseVideoUrl,
  type AgentExperienceView,
} from '@havenhub/shared';

import { AppException, Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { ImageProcessor } from '../../infrastructure/media/image-processor.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { PlanLimitsService } from '../plans/plan-limits.service';
import { PropertyAccessService } from '../properties/property-access.service';
import { AgentExperiencesService, validationError } from './agent-experiences.service';
import { ExperienceAccessService } from './experience-access.service';
import type { AgentExperienceRow } from './experience.selects';

/**
 * Images and videos of an agent's own listing, through the same storage
 * abstraction and image pipeline as property media (re-encoded WebP, public
 * unguessable keys). Images count towards the plan's storage allowance.
 * Per-listing counts are bounded by technical caps, not plan limits — the
 * plans' image/video allowances are defined per *property*.
 */
@Injectable()
export class ExperienceMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: PropertyAccessService,
    private readonly access: ExperienceAccessService,
    private readonly plans: PlanLimitsService,
    private readonly images: ImageProcessor,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly experiences: AgentExperiencesService,
  ) {}

  async addImage(
    userId: string,
    id: string,
    file: Buffer,
    meta: RequestMeta,
  ): Promise<AgentExperienceView> {
    const agent = await this.agents.agentFor(userId);
    this.agents.assertCanManage(agent);
    const before = await this.access.owned(agent.id, id);
    this.access.assertEditable(before.status);
    if (before.status === ExperienceStatus.PUBLISHED) this.agents.assertVerified(agent);
    assertRoom(before.images.length, EXPERIENCE_LIMITS.images, 'images');

    // Decode/re-encode before touching the database (also rejects non-images).
    const { large, thumbnail } = await this.images.listingRenditions(file);
    const prefix = `experiences/${id}`;
    const largeKey = this.storage.newKey(prefix, 'lg');
    const thumbKey = this.storage.newKey(prefix, 'sm');
    await Promise.all([
      this.storage.put(largeKey, large.buffer, 'image/webp'),
      this.storage.put(thumbKey, thumbnail.buffer, 'image/webp'),
    ]);

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // Agent lock first (storage allowance), then the listing.
        await this.plans.assertStorageFor(tx, agent.id, large.buffer.length);
        const current = await this.access.ownedEditable(tx, agent.id, id);
        assertRoom(current.images.length, EXPERIENCE_LIMITS.images, 'images');
        await tx.experienceImage.create({
          data: {
            experienceId: id,
            storageKey: largeKey,
            thumbnailKey: thumbKey,
            width: large.width,
            height: large.height,
            bytes: large.buffer.length,
            sortOrder: current.images.length,
            isPrimary: current.images.length === 0,
          },
        });
        await this.access.backToReviewIfPublished(tx, current);
        await this.audit.record(
          {
            actorId: userId,
            action: 'experience.image_added',
            resourceType: 'experience',
            resourceId: id,
            meta,
          },
          tx,
        );
        return this.access.owned(agent.id, id, tx);
      });
      return this.experiences.view(row);
    } catch (error) {
      await this.storage.deleteQuietly(largeKey, thumbKey);
      throw error;
    }
  }

  async updateImage(
    userId: string,
    id: string,
    imageId: string,
    input: { altText?: string | null; isPrimary?: true },
  ): Promise<AgentExperienceView> {
    const agent = await this.agents.agentFor(userId);
    this.agents.assertCanManage(agent);
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.access.ownedEditable(tx, agent.id, id);
      ownedImage(current, imageId);
      if (input.isPrimary) {
        await tx.experienceImage.updateMany({
          where: { experienceId: id, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      await tx.experienceImage.update({
        where: { id: imageId },
        data: { altText: input.altText, ...(input.isPrimary ? { isPrimary: true } : {}) },
      });
      return this.access.owned(agent.id, id, tx);
    });
    return this.experiences.view(row);
  }

  async reorderImages(userId: string, id: string, imageIds: string[]) {
    const agent = await this.agents.agentFor(userId);
    this.agents.assertCanManage(agent);
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.access.ownedEditable(tx, agent.id, id);
      const existing = new Set(current.images.map((i) => i.id));
      if (imageIds.length !== existing.size || imageIds.some((i) => !existing.has(i))) {
        throw Errors.badRequest('Provide every image of this listing exactly once.');
      }
      await Promise.all(
        imageIds.map((imageId, index) =>
          tx.experienceImage.update({ where: { id: imageId }, data: { sortOrder: index } }),
        ),
      );
      return this.access.owned(agent.id, id, tx);
    });
    return this.experiences.view(row);
  }

  async deleteImage(
    userId: string,
    id: string,
    imageId: string,
    meta: RequestMeta,
  ): Promise<AgentExperienceView> {
    const agent = await this.agents.agentFor(userId);
    this.agents.assertCanManage(agent);
    let removed: { storageKey: string; thumbnailKey: string } | undefined;
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.access.ownedEditable(tx, agent.id, id);
      const image = ownedImage(current, imageId);
      if (current.status === ExperienceStatus.PUBLISHED && current.images.length === 1) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.PROPERTY_LOCKED,
          'A published listing needs at least one image. Add another image first.',
        );
      }
      await tx.experienceImage.delete({ where: { id: image.id } });
      if (image.isPrimary) {
        const next = current.images.find((i) => i.id !== image.id);
        if (next)
          await tx.experienceImage.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
      await this.audit.record(
        {
          actorId: userId,
          action: 'experience.image_deleted',
          resourceType: 'experience',
          resourceId: id,
          meta,
        },
        tx,
      );
      removed = image;
      return this.access.owned(agent.id, id, tx);
    });
    if (removed) await this.storage.deleteQuietly(removed.storageKey, removed.thumbnailKey);
    return this.experiences.view(row);
  }

  async addVideo(
    userId: string,
    id: string,
    input: { url: string; title?: string },
    meta: RequestMeta,
  ): Promise<AgentExperienceView> {
    const agent = await this.agents.agentFor(userId);
    this.agents.assertCanManage(agent);
    const parsed = parseVideoUrl(input.url);
    if (!parsed) throw validationError('url', 'Paste a YouTube or Vimeo link');
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.access.ownedEditable(tx, agent.id, id);
      if (current.status === ExperienceStatus.PUBLISHED) this.agents.assertVerified(agent);
      assertRoom(current.videos.length, EXPERIENCE_LIMITS.videos, 'videos');
      if (
        current.videos.some(
          (v) => v.provider === parsed.provider && v.externalId === parsed.externalId,
        )
      ) {
        throw Errors.conflict('This video is already attached.');
      }
      await tx.experienceVideo.create({
        data: {
          experienceId: id,
          ...parsed,
          title: input.title ?? null,
          sortOrder: current.videos.length,
        },
      });
      await this.access.backToReviewIfPublished(tx, current);
      await this.audit.record(
        {
          actorId: userId,
          action: 'experience.video_added',
          resourceType: 'experience',
          resourceId: id,
          meta,
        },
        tx,
      );
      return this.access.owned(agent.id, id, tx);
    });
    return this.experiences.view(row);
  }

  async deleteVideo(userId: string, id: string, videoId: string) {
    const agent = await this.agents.agentFor(userId);
    this.agents.assertCanManage(agent);
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.access.ownedEditable(tx, agent.id, id);
      if (!current.videos.some((v) => v.id === videoId)) throw Errors.notFound('Video');
      await tx.experienceVideo.delete({ where: { id: videoId } });
      return this.access.owned(agent.id, id, tx);
    });
    return this.experiences.view(row);
  }
}

function ownedImage(row: AgentExperienceRow, imageId: string) {
  const image = row.images.find((i) => i.id === imageId);
  if (!image) throw Errors.notFound('Image');
  return image;
}

function assertRoom(count: number, max: number, what: string) {
  if (count >= max) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.CONFLICT,
      `A listing can have at most ${max} ${what}. Remove one to add another.`,
    );
  }
}
