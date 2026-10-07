import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ATTACHMENT_LIMITS, ErrorCode, type MessageAttachmentView } from '@havenhub/shared';
import type { Response } from 'express';

import { AppException, Errors } from '../../common/errors/app.exception';
import type { MessageAttachment } from '../../generated/prisma/client';
import { ImageProcessor } from '../../infrastructure/media/image-processor.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { detectAttachmentType, maxBytesFor, safeFileName } from './attachment-types';
import { attachmentUrl } from './chat.mapper';
import { ChatAccessService } from './chat-access.service';
import { PlatformPoliciesService } from '../platform/platform-policies.service';
import { ConversationsService } from './conversations.service';

/** Uploads not sent in a message within this window are deleted. */
export const UNATTACHED_TTL_HOURS = 24;
const MAX_PENDING_PER_CONVERSATION = 20;

/**
 * Chat attachments: uploaded first (two-step), then referenced by a message.
 *
 * - Type comes from the file's bytes, never from the client; images are
 *   re-encoded (metadata stripped); everything else must match a short
 *   allowlist of media and document formats.
 * - Files are stored under the private `chat/` prefix and only ever streamed
 *   by `download`, which checks that the caller participates in the
 *   conversation. Clients never see storage keys or bucket URLs.
 */
@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChatAccessService,
    private readonly conversations: ConversationsService,
    private readonly images: ImageProcessor,
    private readonly storage: StorageService,
    private readonly policies: PlatformPoliciesService,
  ) {}

  async upload(
    userId: string,
    conversationId: string,
    file: Express.Multer.File,
  ): Promise<MessageAttachmentView> {
    await this.access.participant(conversationId, userId);
    const policies = await this.policies.get();
    if (!policies.chat.attachments) {
      throw Errors.featureDisabled('Attachments are turned off in chat right now.');
    }
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { status: true },
    });
    this.conversations.assertOpen(conversation.status);
    const pending = await this.prisma.messageAttachment.count({
      where: { conversationId, uploaderId: userId, messageId: null },
    });
    if (pending >= MAX_PENDING_PER_CONVERSATION) {
      throw invalid('Send or remove your pending attachments before uploading more.');
    }

    const detected = detectAttachmentType(file.buffer, file.originalname, file.mimetype);
    if (!detected) {
      throw invalid(
        'This file type is not supported. Send photos, videos, audio, PDF, Word, Excel, PowerPoint, TXT or CSV files.',
      );
    }
    if (file.size > maxBytesFor(detected.kind)) {
      throw invalid(`That file is too large. ${ATTACHMENT_LIMITS[detected.kind].label}.`);
    }
    const policyMb = policies.storage.chatAttachmentMaxMb;
    if (file.size > policyMb * 1024 * 1024) {
      throw invalid(`That file is too large. Attachments can be up to ${policyMb} MB.`);
    }

    const prefix = `chat/${conversationId}`;
    let main: { key: string; body: Buffer };
    let thumb: { key: string; body: Buffer } | null = null;
    let width: number | null = null;
    let height: number | null = null;
    if (detected.reencode) {
      const { display, thumbnail } = await this.images.chatRenditions(file.buffer);
      main = { key: this.storage.newKey(prefix, 'image', 'webp'), body: display.buffer };
      thumb = { key: this.storage.newKey(prefix, 'thumb', 'webp'), body: thumbnail.buffer };
      width = display.width;
      height = display.height;
    } else {
      main = { key: this.storage.newKey(prefix, 'file', detected.ext), body: file.buffer };
    }

    const keys = [main.key, ...(thumb ? [thumb.key] : [])];
    try {
      await this.storage.put(main.key, main.body, detected.contentType);
      if (thumb) await this.storage.put(thumb.key, thumb.body, 'image/webp');
      const row = await this.prisma.messageAttachment.create({
        data: {
          conversationId,
          uploaderId: userId,
          kind: detected.kind,
          storageKey: main.key,
          thumbnailKey: thumb?.key ?? null,
          contentType: detected.contentType,
          fileName: safeFileName(file.originalname, detected.ext),
          bytes: main.body.length,
          width,
          height,
        },
      });
      return toAttachmentView(row);
    } catch (error) {
      this.logger.error(
        `Attachment upload failed in conversation ${conversationId}: ${(error as Error).message}`,
      );
      await this.storage.deleteQuietly(...keys);
      throw error;
    }
  }

  /** Streams a file to a participant; unsent uploads only to their uploader. */
  async download(
    userId: string,
    conversationId: string,
    attachmentId: string,
    variant: string | undefined,
    res: Response,
  ): Promise<void> {
    await this.access.participant(conversationId, userId).catch(() => {
      throw Errors.notFound('File');
    });
    const attachment = await this.prisma.messageAttachment.findFirst({
      where: { id: attachmentId, conversationId },
      include: { message: { select: { deletedAt: true } } },
    });
    if (
      !attachment ||
      (attachment.messageId === null && attachment.uploaderId !== userId) ||
      attachment.message?.deletedAt
    ) {
      throw Errors.notFound('File');
    }
    await this.stream(attachment, variant, res);
  }

  /** For moderators (permission and audit handled by the caller). */
  async stream(attachment: MessageAttachment, variant: string | undefined, res: Response) {
    const key =
      variant === 'thumbnail' && attachment.thumbnailKey
        ? attachment.thumbnailKey
        : attachment.storageKey;
    const file = await this.storage.driver.read(key);
    if (!file) {
      this.logger.warn(`Attachment ${attachment.id} is missing from storage`);
      throw Errors.notFound('File');
    }
    const inline =
      ['IMAGE', 'VIDEO', 'AUDIO'].includes(attachment.kind) ||
      attachment.contentType === 'application/pdf';
    res.setHeader(
      'Content-Type',
      key === attachment.thumbnailKey ? 'image/webp' : attachment.contentType,
    );
    if (file.size) res.setHeader('Content-Length', String(file.size));
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${asciiName(attachment.fileName)}"; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    file.body.pipe(res);
  }

  /** Deletes uploads that were never sent. Returns how many were removed. */
  async cleanupUnattached(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - UNATTACHED_TTL_HOURS * 3600_000);
    const stale = await this.prisma.messageAttachment.findMany({
      where: { messageId: null, createdAt: { lt: cutoff } },
      take: 200,
    });
    let removed = 0;
    for (const a of stale) {
      // Conditional delete: an upload attached concurrently is left alone.
      const { count } = await this.prisma.messageAttachment.deleteMany({
        where: { id: a.id, messageId: null },
      });
      if (count === 0) continue;
      await this.storage.deleteQuietly(a.storageKey, ...(a.thumbnailKey ? [a.thumbnailKey] : []));
      removed++;
    }
    return removed;
  }
}

export const toAttachmentView = (a: MessageAttachment): MessageAttachmentView => ({
  id: a.id,
  kind: a.kind,
  fileName: a.fileName,
  contentType: a.contentType,
  bytes: a.bytes,
  width: a.width,
  height: a.height,
  url: attachmentUrl(a.conversationId, a.id),
  thumbnailUrl: a.thumbnailKey ? attachmentUrl(a.conversationId, a.id, true) : null,
});

const asciiName = (name: string) => name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');

const invalid = (message: string) =>
  new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.INVALID_FILE, message);
