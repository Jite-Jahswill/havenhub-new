import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, PropertyStatus, parseVideoUrl, type AgentPropertyView } from '@havenhub/shared';

import { AppException, Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import type { AgentProfile, Prisma } from '../../generated/prisma/client';
import { ImageProcessor } from '../../infrastructure/media/image-processor.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { ModerationPolicyService } from '../platform/moderation-policy.service';
import { AuditService } from '../audit/audit.service';
import { PlanLimitsService } from '../plans/plan-limits.service';
import { AgentPropertiesService } from './agent-properties.service';
import { PropertyAccessService } from './property-access.service';
import type { AgentPropertyRow } from './property.selects';

type Tx = Prisma.TransactionClient;

/**
 * Images and videos of an agent's own property. Ownership is resolved from
 * the session for every call; media ids are only ever looked up *within*
 * the owned property, so another agent's media cannot be reached.
 */
@Injectable()
export class PropertyMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PropertyAccessService,
    private readonly plans: PlanLimitsService,
    private readonly images: ImageProcessor,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly properties: AgentPropertiesService,
    private readonly policy: ModerationPolicyService,
  ) {}

  async addImage(
    userId: string,
    propertyId: string,
    file: Buffer,
    meta: RequestMeta,
  ): Promise<AgentPropertyView> {
    const agent = await this.editableAgent(userId);
    const before = await this.access.owned(agent.id, propertyId);
    this.access.assertEditable(before.status);
    if (before.status === PropertyStatus.PUBLISHED) this.access.assertVerified(agent);

    // Decode/re-encode before touching the database (also rejects non-images).
    const { large, thumbnail } = await this.images.listingRenditions(file);
    const prefix = `properties/${propertyId}`;
    const largeKey = this.storage.newKey(prefix, 'lg');
    const thumbKey = this.storage.newKey(prefix, 'sm');
    await Promise.all([
      this.storage.put(largeKey, large.buffer, 'image/webp'),
      this.storage.put(thumbKey, thumbnail.buffer, 'image/webp'),
    ]);

    try {
      const property = await this.prisma.$transaction(async (tx) => {
        await this.plans.assertCanAddImage(tx, agent.id, propertyId, large.buffer.length);
        const current = await this.access.owned(agent.id, propertyId, tx);
        this.access.assertEditable(current.status);
        const isFirst = current.images.length === 0;
        await tx.propertyImage.create({
          data: {
            propertyId,
            storageKey: largeKey,
            thumbnailKey: thumbKey,
            width: large.width,
            height: large.height,
            bytes: large.buffer.length,
            sortOrder: current.images.length,
            isPrimary: isFirst,
          },
        });
        await this.backToReviewIfPublished(tx, current);
        await this.audit.record(
          {
            actorId: userId,
            action: 'property.image_added',
            resourceType: 'property',
            resourceId: propertyId,
            meta,
          },
          tx,
        );
        return this.access.owned(agent.id, propertyId, tx);
      });
      return this.properties.view(property);
    } catch (error) {
      await this.storage.deleteQuietly(largeKey, thumbKey);
      throw error;
    }
  }

  async updateImage(
    userId: string,
    propertyId: string,
    imageId: string,
    input: { altText?: string | null; isPrimary?: true },
  ): Promise<AgentPropertyView> {
    const agent = await this.editableAgent(userId);
    const property = await this.prisma.$transaction(async (tx) => {
      const current = await this.ownedEditable(tx, agent, propertyId);
      ownedImage(current, imageId);
      if (input.isPrimary) {
        await tx.propertyImage.updateMany({
          where: { propertyId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      await tx.propertyImage.update({
        where: { id: imageId },
        data: { altText: input.altText, ...(input.isPrimary ? { isPrimary: true } : {}) },
      });
      return this.access.owned(agent.id, propertyId, tx);
    });
    return this.properties.view(property);
  }

  async reorderImages(
    userId: string,
    propertyId: string,
    imageIds: string[],
  ): Promise<AgentPropertyView> {
    const agent = await this.editableAgent(userId);
    const property = await this.prisma.$transaction(async (tx) => {
      const current = await this.ownedEditable(tx, agent, propertyId);
      const existing = new Set(current.images.map((i) => i.id));
      if (imageIds.length !== existing.size || imageIds.some((id) => !existing.has(id))) {
        throw Errors.badRequest('Provide every image of this property exactly once.');
      }
      await Promise.all(
        imageIds.map((id, index) =>
          tx.propertyImage.update({ where: { id }, data: { sortOrder: index } }),
        ),
      );
      return this.access.owned(agent.id, propertyId, tx);
    });
    return this.properties.view(property);
  }

  async deleteImage(
    userId: string,
    propertyId: string,
    imageId: string,
    meta: RequestMeta,
  ): Promise<AgentPropertyView> {
    const agent = await this.editableAgent(userId);
    let removed: { storageKey: string; thumbnailKey: string } | undefined;
    const property = await this.prisma.$transaction(async (tx) => {
      const current = await this.ownedEditable(tx, agent, propertyId);
      const image = ownedImage(current, imageId);
      if (current.status === PropertyStatus.PUBLISHED && current.images.length === 1) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.PROPERTY_LOCKED,
          'A published property needs at least one image. Add another image first.',
        );
      }
      await tx.propertyImage.delete({ where: { id: image.id } });
      if (image.isPrimary) {
        const next = current.images.find((i) => i.id !== image.id);
        if (next)
          await tx.propertyImage.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
      await this.audit.record(
        {
          actorId: userId,
          action: 'property.image_deleted',
          resourceType: 'property',
          resourceId: propertyId,
          meta,
        },
        tx,
      );
      removed = image;
      return this.access.owned(agent.id, propertyId, tx);
    });
    if (removed) await this.storage.deleteQuietly(removed.storageKey, removed.thumbnailKey);
    return this.properties.view(property);
  }

  async addVideo(
    userId: string,
    propertyId: string,
    input: { url: string; title?: string },
    meta: RequestMeta,
  ): Promise<AgentPropertyView> {
    const agent = await this.editableAgent(userId);
    const parsed = parseVideoUrl(input.url);
    if (!parsed) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.VALIDATION_ERROR,
        'Please check the highlighted fields.',
        {
          issues: [{ path: 'url', message: 'Paste a YouTube or Vimeo link' }],
        },
      );
    }
    const property = await this.prisma.$transaction(async (tx) => {
      const current = await this.ownedEditable(tx, agent, propertyId);
      if (current.status === PropertyStatus.PUBLISHED) this.access.assertVerified(agent);
      await this.plans.assertCanAddVideo(tx, agent.id, propertyId);
      if (
        current.videos.some(
          (v) => v.provider === parsed.provider && v.externalId === parsed.externalId,
        )
      ) {
        throw Errors.conflict('This video is already attached.');
      }
      await tx.propertyVideo.create({
        data: {
          propertyId,
          ...parsed,
          title: input.title ?? null,
          sortOrder: current.videos.length,
        },
      });
      await this.backToReviewIfPublished(tx, current);
      await this.audit.record(
        {
          actorId: userId,
          action: 'property.video_added',
          resourceType: 'property',
          resourceId: propertyId,
          meta,
        },
        tx,
      );
      return this.access.owned(agent.id, propertyId, tx);
    });
    return this.properties.view(property);
  }

  async deleteVideo(
    userId: string,
    propertyId: string,
    videoId: string,
  ): Promise<AgentPropertyView> {
    const agent = await this.editableAgent(userId);
    const property = await this.prisma.$transaction(async (tx) => {
      const current = await this.ownedEditable(tx, agent, propertyId);
      if (!current.videos.some((v) => v.id === videoId)) throw Errors.notFound('Video');
      await tx.propertyVideo.delete({ where: { id: videoId } });
      return this.access.owned(agent.id, propertyId, tx);
    });
    return this.properties.view(property);
  }

  private async editableAgent(userId: string): Promise<AgentProfile> {
    const agent = await this.access.agentFor(userId);
    this.access.assertCanManage(agent);
    return agent;
  }

  private async ownedEditable(
    tx: Tx,
    agent: AgentProfile,
    propertyId: string,
  ): Promise<AgentPropertyRow> {
    const current = await this.access.owned(agent.id, propertyId, tx);
    this.access.assertEditable(current.status);
    return current;
  }

  /**
   * New media on a live listing must be moderated before the public sees it
   * (unless the moderation policy publishes properties without review).
   */
  private async backToReviewIfPublished(tx: Tx, current: AgentPropertyRow): Promise<void> {
    if (current.status !== PropertyStatus.PUBLISHED) return;
    if (!(await this.policy.requiresReview('PROPERTY', tx))) return;
    await tx.property.update({
      where: { id: current.id },
      data: {
        status: PropertyStatus.PENDING_REVIEW,
        submittedAt: new Date(),
        moderationNote: null,
      },
    });
  }
}

function ownedImage(property: AgentPropertyRow, imageId: string) {
  const image = property.images.find((i) => i.id === imageId);
  if (!image) throw Errors.notFound('Image');
  return image;
}
