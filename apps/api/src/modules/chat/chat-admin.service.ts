import { Injectable } from '@nestjs/common';
import {
  ChatEvent,
  type AdminConversationDetail,
  type AdminConversationListItem,
  type AdminMessageView,
  type Paginated,
  type adminListConversationsQuerySchema,
} from '@havenhub/shared';
import type { Response } from 'express';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { paginate } from '../../common/http/response';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { AttachmentsService } from './attachments.service';
import {
  CHAT_USER_SELECT,
  CONVERSATION_INCLUDE,
  MESSAGE_INCLUDE,
  chatDisplayName,
  toChatUser,
  toContext,
  toMessageView,
} from './chat.mapper';
import { ChatEventsService } from './chat-events.service';
import { MessagesService } from './messages.service';

const ADMIN_PAGE = 50;

const ADMIN_CONVERSATION_INCLUDE = {
  ...CONVERSATION_INCLUDE,
  participants: {
    include: { user: { select: { ...CHAT_USER_SELECT, email: true } } },
    orderBy: { joinedAt: 'asc' },
  },
} as const satisfies Prisma.ConversationInclude;

type AdminConversationRow = Prisma.ConversationGetPayload<{
  include: typeof ADMIN_CONVERSATION_INCLUDE;
}>;

/**
 * Support/moderation access to conversations. Gated by explicit permissions
 * (`conversations.view`, `messages.moderate`) — not by being an admin — and
 * every read of a conversation or file is written to the audit log, as is
 * every moderation action.
 */
@Injectable()
export class ChatAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: ChatEventsService,
    private readonly messages: MessagesService,
    private readonly attachments: AttachmentsService,
    private readonly storage: StorageService,
  ) {}

  async list(
    query: z.output<typeof adminListConversationsQuerySchema>,
  ): Promise<Paginated<AdminConversationListItem>> {
    const search = query.search
      ? { contains: query.search, mode: 'insensitive' as const }
      : undefined;
    const where: Prisma.ConversationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { property: { title: search } },
              { experience: { title: search } },
              { booking: { reference: search } },
              {
                participants: {
                  some: {
                    user: {
                      OR: [
                        { email: search },
                        { fullName: search },
                        { agentProfile: { businessName: search } },
                      ],
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({
        where,
        orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: ADMIN_CONVERSATION_INCLUDE,
      }),
    ]);
    return paginate(
      rows.map((r) => this.item(r)),
      query.page,
      query.pageSize,
      total,
    );
  }

  async detail(
    actorId: string,
    conversationId: string,
    before: number | undefined,
    meta: RequestMeta,
  ): Promise<AdminConversationDetail> {
    const row = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: ADMIN_CONVERSATION_INCLUDE,
    });
    if (!row) throw Errors.notFound('Conversation');
    await this.audit.record({
      actorId,
      action: 'conversation.viewed',
      resourceType: 'conversation',
      resourceId: conversationId,
      after: { before: before ?? null },
      meta,
    });
    const messages = await this.prisma.message.findMany({
      where: { conversationId, ...(before ? { seq: { lt: before } } : {}) },
      orderBy: { seq: 'desc' },
      take: ADMIN_PAGE + 1,
      include: {
        ...MESSAGE_INCLUDE,
        revisions: { orderBy: { createdAt: 'asc' } },
        deletedBy: { select: { id: true, fullName: true } },
      },
    });
    const page = messages.slice(0, ADMIN_PAGE).reverse();
    return {
      ...this.item(row),
      closedAt: row.closedAt?.toISOString() ?? null,
      closedReason: row.closedReason,
      hasMore: messages.length > ADMIN_PAGE,
      messages: page.map((m): AdminMessageView => {
        const view = toMessageView(m, actorId, this.storage, 0);
        return {
          ...view,
          canEdit: false,
          canDelete: false,
          // Moderators review removed content and files through admin-only URLs.
          attachments: m.attachments.map((a) => ({
            id: a.id,
            kind: a.kind,
            fileName: a.fileName,
            contentType: a.contentType,
            bytes: a.bytes,
            width: a.width,
            height: a.height,
            url: adminAttachmentUrl(conversationId, a.id),
            thumbnailUrl: a.thumbnailKey
              ? `${adminAttachmentUrl(conversationId, a.id)}?variant=thumbnail`
              : null,
          })),
          originalBody: m.body,
          revisions: m.revisions.map((r) => ({
            body: r.body,
            createdAt: r.createdAt.toISOString(),
          })),
          deletedBy: m.deletedBy ? { id: m.deletedBy.id, name: m.deletedBy.fullName } : null,
        };
      }),
    };
  }

  async attachment(
    actorId: string,
    conversationId: string,
    attachmentId: string,
    variant: string | undefined,
    res: Response,
    meta: RequestMeta,
  ): Promise<void> {
    const attachment = await this.prisma.messageAttachment.findFirst({
      where: { id: attachmentId, conversationId, messageId: { not: null } },
    });
    if (!attachment) throw Errors.notFound('File');
    await this.audit.record({
      actorId,
      action: 'conversation.attachment_viewed',
      resourceType: 'message_attachment',
      resourceId: attachmentId,
      after: { conversationId },
      meta,
    });
    await this.attachments.stream(attachment, variant, res);
  }

  /** Removes a message for everyone (soft delete), with a recorded reason. */
  async removeMessage(actorId: string, messageId: string, reason: string, meta: RequestMeta) {
    const changed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM messages WHERE id = ${messageId}::uuid FOR UPDATE`;
      const message = await tx.message.findUnique({ where: { id: messageId } });
      if (!message) throw Errors.notFound('Message');
      if (message.deletedAt) return false;
      await tx.message.update({
        where: { id: messageId },
        data: { deletedAt: new Date(), deletedById: actorId },
      });
      await this.audit.record(
        {
          actorId,
          action: 'message.moderated',
          resourceType: 'message',
          resourceId: messageId,
          before: { deleted: false },
          after: { deleted: true, conversationId: message.conversationId, reason },
          meta,
        },
        tx,
      );
      return true;
    });
    if (changed) await this.events.messageChanged(ChatEvent.MESSAGE_DELETED, messageId);
    return { removed: changed };
  }

  /** Closing stops new messages (history stays readable); reopening allows them again. */
  async setStatus(
    actorId: string,
    conversationId: string,
    status: 'OPEN' | 'CLOSED',
    reason: string,
    meta: RequestMeta,
  ) {
    const systemMessageId = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ status: string }[]>`
        SELECT status FROM conversations WHERE id = ${conversationId}::uuid FOR UPDATE`;
      if (!row) throw Errors.notFound('Conversation');
      if (row.status === status) return null;
      await tx.conversation.update({
        where: { id: conversationId },
        data:
          status === 'CLOSED'
            ? { status, closedAt: new Date(), closedById: actorId, closedReason: reason }
            : { status, closedAt: null, closedById: null, closedReason: null },
      });
      await this.audit.record(
        {
          actorId,
          action: status === 'CLOSED' ? 'conversation.closed' : 'conversation.reopened',
          resourceType: 'conversation',
          resourceId: conversationId,
          before: { status: row.status },
          after: { status, reason },
          meta,
        },
        tx,
      );
      return this.messages.createSystem(
        tx,
        conversationId,
        status === 'CLOSED'
          ? 'This conversation was closed by HavenHub support.'
          : 'This conversation was reopened by HavenHub support.',
        { event: status === 'CLOSED' ? 'conversation.closed' : 'conversation.reopened' },
      );
    });
    if (systemMessageId) {
      await this.events.messageChanged(ChatEvent.MESSAGE_CREATED, systemMessageId);
      await this.events.conversation(ChatEvent.CONVERSATION_UPDATED, conversationId);
    }
    return { changed: systemMessageId !== null };
  }

  private item(row: AdminConversationRow): AdminConversationListItem {
    return {
      id: row.id,
      status: row.status,
      context: toContext(row, this.storage),
      participants: row.participants.map((p) => ({
        ...toChatUser(p.user, this.storage, p.role),
        name: chatDisplayName(p.user),
        email: p.user.email,
      })),
      messageCount: row.lastSeq,
      lastActivityAt: row.lastActivityAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}

const adminAttachmentUrl = (conversationId: string, attachmentId: string) =>
  `/api/v1/admin/conversations/${conversationId}/attachments/${attachmentId}`;
