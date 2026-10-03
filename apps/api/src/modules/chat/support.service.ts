import { Injectable } from '@nestjs/common';
import {
  ChatEvent,
  type Paginated,
  type SupportConversationItem,
  type adminSupportListQuerySchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { Errors } from '../../common/errors/app.exception';
import type { RequestMeta } from '../../common/http/request-meta';
import { paginate } from '../../common/http/response';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { chatDisplayName } from './chat.mapper';
import { ChatEventsService } from './chat-events.service';
import { MessagesService } from './messages.service';

type ListQuery = z.output<typeof adminSupportListQuerySchema>;

/**
 * The support queue (Phase 7). A SUPPORT conversation starts with only the
 * customer or agent who asked for help. A support admin joins it — becoming
 * an ordinary participant, audited — and from then on reads and replies
 * through the normal chat endpoints, with the same authorisation, ordering
 * and realtime delivery as every other conversation. No second messaging
 * system exists.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly messages: MessagesService,
    private readonly events: ChatEventsService,
  ) {}

  async list(viewerId: string, query: ListQuery): Promise<Paginated<SupportConversationItem>> {
    const search = query.search
      ? { contains: query.search, mode: 'insensitive' as const }
      : undefined;
    const where: Prisma.ConversationWhereInput = {
      contextType: 'SUPPORT',
      ...(query.status ? { status: query.status } : {}),
      ...(query.scope === 'mine' ? { participants: { some: { userId: viewerId } } } : {}),
      ...(query.scope === 'unassigned' ? { participants: { none: { role: 'ADMIN' } } } : {}),
      ...(search
        ? { participants: { some: { user: { OR: [{ email: search }, { fullName: search }] } } } }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({
        where,
        orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          participants: {
            orderBy: { joinedAt: 'asc' },
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  fullName: true,
                  agentProfile: { select: { businessName: true } },
                },
              },
            },
          },
        },
      }),
    ]);
    return paginate(
      rows.map((row) => {
        const requester = row.participants.find((p) => p.role !== 'ADMIN');
        return {
          id: row.id,
          status: row.status,
          requester: requester
            ? {
                id: requester.user.id,
                name: chatDisplayName(requester.user),
                email: requester.user.email,
                role: requester.role,
              }
            : null,
          staff: row.participants
            .filter((p) => p.role === 'ADMIN')
            .map((p) => ({ id: p.user.id, name: p.user.fullName })),
          joined: row.participants.some((p) => p.userId === viewerId),
          lastActivityAt: row.lastActivityAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
        };
      }),
      query.page,
      query.pageSize,
      total,
    );
  }

  /** Idempotent: joining twice changes nothing. */
  async join(actor: { id: string; fullName: string }, conversationId: string, meta: RequestMeta) {
    const systemMessageId = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ context_type: string }[]>`
        SELECT context_type FROM conversations WHERE id = ${conversationId}::uuid FOR UPDATE`;
      // Only support conversations can be joined; anything else does not exist here.
      if (!row || row.context_type !== 'SUPPORT') throw Errors.notFound('Conversation');
      const existing = await tx.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId, userId: actor.id } },
      });
      if (existing) return null;
      const last = await tx.conversation.findUniqueOrThrow({
        where: { id: conversationId },
        select: { lastSeq: true },
      });
      // Joining staff start "read" at the current end, like any newcomer.
      await tx.conversationParticipant.create({
        data: { conversationId, userId: actor.id, role: 'ADMIN', lastReadSeq: last.lastSeq },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'support.joined',
          resourceType: 'conversation',
          resourceId: conversationId,
          meta,
        },
        tx,
      );
      return this.messages.createSystem(
        tx,
        conversationId,
        `${actor.fullName} from HavenHub support joined the conversation.`,
        { event: 'support.joined' },
      );
    });
    if (systemMessageId) {
      await this.events.messageChanged(ChatEvent.MESSAGE_CREATED, systemMessageId);
      await this.events.conversation(ChatEvent.CONVERSATION_UPDATED, conversationId);
    }
    return { joined: true, conversationId };
  }
}
