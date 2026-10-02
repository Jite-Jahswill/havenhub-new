import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ChatEvent,
  ErrorCode,
  MESSAGE_EDIT_WINDOW_MINUTES,
  type MessagePage,
  type MessageType,
  type MessageView,
  type listMessagesQuerySchema,
  type sendMessageSchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { AppException, Errors } from '../../common/errors/app.exception';
import { Prisma, type AttachmentKind } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { MESSAGE_INCLUDE, toMessageView } from './chat.mapper';
import { ChatAccessService } from './chat-access.service';
import { ChatEventsService } from './chat-events.service';
import { ChatNotificationsService } from './chat-notifications.service';
import { ConversationsService } from './conversations.service';

type Tx = Prisma.TransactionClient;
type SendInput = z.output<typeof sendMessageSchema>;
type PageQuery = z.output<typeof listMessagesQuerySchema>;

/**
 * Message lifecycle.
 *
 * - Ordering: each message gets the conversation's next `seq`, allocated
 *   under the conversation row lock — gap-free per conversation and the basis
 *   of pagination and read cursors.
 * - Idempotency: (sender, clientKey) is unique in the database. A retried or
 *   duplicated send returns the original message instead of a new one.
 * - Editing: own text messages only, for MESSAGE_EDIT_WINDOW_MINUTES; the
 *   previous text is kept in MessageRevision (visible to moderators only).
 * - Deleting: own messages, any time; a soft delete. Content, attachments,
 *   reply quote and reactions disappear from every API response, but the row
 *   and files are kept for moderation.
 */
@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChatAccessService,
    private readonly conversations: ConversationsService,
    private readonly events: ChatEventsService,
    private readonly notifications: ChatNotificationsService,
    private readonly storage: StorageService,
  ) {}

  async list(userId: string, conversationId: string, query: PageQuery): Promise<MessagePage> {
    await this.access.participant(conversationId, userId);
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { lastSeq: true },
    });
    const newer = query.after !== undefined;
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(newer
          ? { seq: { gt: query.after } }
          : query.before
            ? { seq: { lt: query.before } }
            : {}),
      },
      orderBy: { seq: newer ? 'asc' : 'desc' },
      take: query.limit + 1,
      include: MESSAGE_INCLUDE,
    });
    const page = rows.slice(0, query.limit);
    if (!newer) page.reverse();
    const now = new Date();
    return {
      items: page.map((m) => toMessageView(m, userId, this.storage, now)),
      hasMore: rows.length > query.limit,
      lastSeq: conversation.lastSeq,
    };
  }

  async send(
    userId: string,
    conversationId: string,
    input: SendInput,
  ): Promise<{ message: MessageView; created: boolean }> {
    const replay = await this.findByClientKey(userId, input.clientKey, conversationId);
    if (replay) return { message: replay, created: false };

    let messageId: string;
    try {
      messageId = await this.prisma.$transaction((tx) =>
        this.create(tx, userId, conversationId, input),
      );
    } catch (error) {
      // A concurrent duplicate won the race on (sender, clientKey).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.findByClientKey(userId, input.clientKey, conversationId);
        if (winner) return { message: winner, created: false };
      }
      if (!(error instanceof AppException)) {
        this.logger.error(
          `Message send failed in conversation ${conversationId}: ${(error as Error).message}`,
        );
      }
      throw error;
    }

    await this.events.messageChanged(ChatEvent.MESSAGE_CREATED, messageId);
    await this.notifications.messageCreated(conversationId, messageId, userId);
    return { message: await this.view(messageId, userId), created: true };
  }

  private async create(tx: Tx, userId: string, conversationId: string, input: SendInput) {
    await this.access.participant(conversationId, userId, tx);
    const [conversation] = await tx.$queryRaw<{ status: string; last_seq: number }[]>`
      SELECT status, last_seq FROM conversations WHERE id = ${conversationId}::uuid FOR UPDATE`;
    if (!conversation) throw Errors.notFound('Conversation');
    this.conversations.assertOpen(conversation.status);

    if (input.replyToId) {
      const original = await tx.message.findFirst({
        where: { id: input.replyToId, conversationId, deletedAt: null },
        select: { id: true },
      });
      if (!original) {
        throw new AppException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          ErrorCode.VALIDATION_ERROR,
          'The message you are replying to is no longer available.',
        );
      }
    }

    let kinds: AttachmentKind[] = [];
    if (input.attachmentIds.length > 0) {
      await tx.$queryRaw`SELECT id FROM message_attachments
        WHERE id IN (${Prisma.join(input.attachmentIds.map((id) => Prisma.sql`${id}::uuid`))}) FOR UPDATE`;
      const attachments = await tx.messageAttachment.findMany({
        where: {
          id: { in: input.attachmentIds },
          conversationId,
          uploaderId: userId,
          messageId: null,
        },
        select: { kind: true },
      });
      if (attachments.length !== input.attachmentIds.length) {
        throw new AppException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          ErrorCode.VALIDATION_ERROR,
          'One or more attachments are not available. Upload them again.',
        );
      }
      kinds = attachments.map((a) => a.kind);
    }

    const seq = conversation.last_seq + 1;
    const now = new Date();
    const message = await tx.message.create({
      data: {
        conversationId,
        seq,
        senderId: userId,
        type: messageType(kinds),
        body: input.body || null,
        replyToId: input.replyToId ?? null,
        clientKey: input.clientKey,
        createdAt: now,
      },
      select: { id: true },
    });
    if (input.attachmentIds.length > 0) {
      await tx.messageAttachment.updateMany({
        where: { id: { in: input.attachmentIds } },
        data: { messageId: message.id },
      });
    }
    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastSeq: seq, lastMessageId: message.id, lastActivityAt: now },
    });
    // Sending implies having read everything before; a new message brings
    // the conversation back for anyone who archived it.
    await tx.$executeRaw`
      UPDATE conversation_participants
      SET archived_at = NULL,
          last_read_seq = CASE WHEN user_id = ${userId}::uuid THEN GREATEST(last_read_seq, ${seq}::int) ELSE last_read_seq END,
          last_read_at = CASE WHEN user_id = ${userId}::uuid THEN now() ELSE last_read_at END
      WHERE conversation_id = ${conversationId}::uuid`;
    return message.id;
  }

  /**
   * A SYSTEM message (no sender), e.g. "closed by support". Allocates the
   * next seq like any message; the caller publishes the event after commit.
   */
  async createSystem(
    tx: Tx,
    conversationId: string,
    body: string,
    metadata: Record<string, string>,
  ): Promise<string> {
    const [row] = await tx.$queryRaw<{ last_seq: number }[]>`
      UPDATE conversations SET last_seq = last_seq + 1, last_activity_at = now()
      WHERE id = ${conversationId}::uuid RETURNING last_seq`;
    if (!row) throw Errors.notFound('Conversation');
    const message = await tx.message.create({
      data: { conversationId, seq: row.last_seq, type: 'SYSTEM', body, metadata },
      select: { id: true },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageId: message.id },
    });
    return message.id;
  }

  async edit(userId: string, messageId: string, body: string): Promise<MessageView> {
    await this.prisma.$transaction(async (tx) => {
      const message = await this.lockOwn(tx, userId, messageId);
      const tooLate =
        Date.now() - message.createdAt.getTime() >= MESSAGE_EDIT_WINDOW_MINUTES * 60_000;
      if (message.deletedAt || message.type === 'SYSTEM' || message.body === null || tooLate) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.MESSAGE_NOT_EDITABLE,
          tooLate
            ? `Messages can only be edited for ${MESSAGE_EDIT_WINDOW_MINUTES} minutes after sending.`
            : 'This message cannot be edited.',
        );
      }
      const conversation = await tx.conversation.findUniqueOrThrow({
        where: { id: message.conversationId },
        select: { status: true },
      });
      this.conversations.assertOpen(conversation.status);
      if (message.body === body) return;
      await tx.messageRevision.create({ data: { messageId, body: message.body } });
      await tx.message.update({ where: { id: messageId }, data: { body, editedAt: new Date() } });
    });
    await this.events.messageChanged(ChatEvent.MESSAGE_UPDATED, messageId);
    return this.view(messageId, userId);
  }

  async remove(userId: string, messageId: string): Promise<MessageView> {
    const changed = await this.prisma.$transaction(async (tx) => {
      const message = await this.lockOwn(tx, userId, messageId);
      if (message.type === 'SYSTEM') {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.MESSAGE_NOT_EDITABLE,
          'System messages cannot be deleted.',
        );
      }
      if (message.deletedAt) return false;
      await tx.message.update({
        where: { id: messageId },
        data: { deletedAt: new Date(), deletedById: userId },
      });
      return true;
    });
    if (changed) await this.events.messageChanged(ChatEvent.MESSAGE_DELETED, messageId);
    return this.view(messageId, userId);
  }

  /** Adds or changes the caller's reaction (one per user per message). */
  async react(userId: string, messageId: string, emoji: string): Promise<MessageView> {
    const message = await this.forParticipant(messageId, userId);
    if (message.deletedAt || message.type === 'SYSTEM') {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.MESSAGE_NOT_EDITABLE,
        'You cannot react to this message.',
      );
    }
    await this.prisma.messageReaction.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: { messageId, userId, emoji },
      update: { emoji },
    });
    await this.events.reactionsChanged(messageId);
    await this.notifications.reactionAdded(message.conversationId, messageId, userId);
    return this.view(messageId, userId);
  }

  async unreact(userId: string, messageId: string): Promise<MessageView> {
    await this.forParticipant(messageId, userId);
    const removed = await this.prisma.messageReaction.deleteMany({ where: { messageId, userId } });
    if (removed.count > 0) await this.events.reactionsChanged(messageId);
    return this.view(messageId, userId);
  }

  async view(messageId: string, viewerId: string): Promise<MessageView> {
    const row = await this.prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      include: MESSAGE_INCLUDE,
    });
    return toMessageView(row, viewerId, this.storage);
  }

  private async findByClientKey(userId: string, clientKey: string, conversationId: string) {
    const existing = await this.prisma.message.findUnique({
      where: { senderId_clientKey: { senderId: userId, clientKey } },
      include: MESSAGE_INCLUDE,
    });
    if (!existing) return null;
    if (existing.conversationId !== conversationId) {
      throw Errors.conflict('This clientKey was already used for another message.');
    }
    return toMessageView(existing, userId, this.storage);
  }

  /** The message, if the caller participates in its conversation (else "not found"). */
  private async forParticipant(messageId: string, userId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true, type: true, deletedAt: true },
    });
    if (!message) throw Errors.notFound('Message');
    await this.access.participant(message.conversationId, userId).catch(() => {
      throw Errors.notFound('Message');
    });
    return message;
  }

  private async lockOwn(tx: Tx, userId: string, messageId: string) {
    await tx.$queryRaw`SELECT id FROM messages WHERE id = ${messageId}::uuid FOR UPDATE`;
    const message = await tx.message.findUnique({ where: { id: messageId } });
    if (!message) throw Errors.notFound('Message');
    await this.access.participant(message.conversationId, userId, tx).catch(() => {
      throw Errors.notFound('Message');
    });
    if (message.senderId !== userId) {
      throw Errors.forbidden('You can only change your own messages.');
    }
    return message;
  }
}

/** Text, or the kind of the attachments (FILE when kinds are mixed). */
function messageType(kinds: AttachmentKind[]): MessageType {
  if (kinds.length === 0) return 'TEXT';
  return kinds.every((k) => k === kinds[0]) ? kinds[0]! : 'FILE';
}
