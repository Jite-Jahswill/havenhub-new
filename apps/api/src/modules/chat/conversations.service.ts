import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AccountType,
  ChatEvent,
  ErrorCode,
  PropertyStatus,
  type ConversationPage,
  type ConversationSummary,
  type StartConversationInput,
  type listConversationsQuerySchema,
} from '@havenhub/shared';
import type { z } from 'zod';

import { AppException, Errors } from '../../common/errors/app.exception';
import { Prisma, type ParticipantRole } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import type { AuthContext } from '../auth/auth.types';
import { PUBLIC_EXPERIENCE_WHERE } from '../experiences/experience.selects';
import { CONVERSATION_INCLUDE, toConversationSummary } from './chat.mapper';
import { ChatAccessService } from './chat-access.service';
import { ChatEventsService } from './chat-events.service';
import { ChatNotificationsService } from './chat-notifications.service';
import { UnreadService } from './unread.service';
import { PlatformPoliciesService } from '../platform/platform-policies.service';

type ListQuery = z.output<typeof listConversationsQuerySchema>;

/**
 * Conversations are about one business context and identified by a
 * deterministic `contextKey`, so "start a conversation" is get-or-create and
 * safe under concurrency (the unique key decides the race).
 *
 * Who may start one:
 *   PROPERTY — a customer, about a published listing, with its agent
 *   BOOKING  — the booking's customer or its agent, with each other
 *   EXPERIENCE — a customer, about a public event/tour/hotel/cleaning
 *               listing, with its agent (no purchase is involved)
 *   SUPPORT  — a customer or agent asking HavenHub for help; support staff
 *              join it from the admin support queue
 * Agents cannot open conversations with arbitrary customers.
 */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChatAccessService,
    private readonly events: ChatEventsService,
    private readonly unread: UnreadService,
    private readonly notifications: ChatNotificationsService,
    private readonly storage: StorageService,
    private readonly policies: PlatformPoliciesService,
  ) {}

  async start(auth: AuthContext, input: StartConversationInput): Promise<ConversationSummary> {
    const me = auth.user;
    let contextKey: string;
    let data: Prisma.ConversationCreateInput;
    let participants: { userId: string; role: ParticipantRole }[];

    if (input.contextType === 'PROPERTY') {
      if (me.accountType !== AccountType.CUSTOMER) {
        throw Errors.forbidden('Only customers can message an agent about a listing.');
      }
      const property = await this.prisma.property.findFirst({
        where: { id: input.propertyId, status: PropertyStatus.PUBLISHED },
        select: { id: true, agentProfile: { select: { userId: true } } },
      });
      if (!property) throw Errors.notFound('Property');
      contextKey = `property:${property.id}:customer:${me.id}`;
      data = { contextType: 'PROPERTY', contextKey, property: { connect: { id: property.id } } };
      participants = [
        { userId: me.id, role: 'CUSTOMER' },
        { userId: property.agentProfile.userId, role: 'AGENT' },
      ];
    } else if (input.contextType === 'EXPERIENCE') {
      if (me.accountType !== AccountType.CUSTOMER) {
        throw Errors.forbidden('Only customers can message an agent about a listing.');
      }
      const listing = await this.prisma.experience.findFirst({
        where: {
          ...PUBLIC_EXPERIENCE_WHERE,
          id: input.experienceId,
          kind: { in: await this.policies.enabledExperienceKinds() },
        },
        select: { id: true, agentProfile: { select: { userId: true } } },
      });
      if (!listing) throw Errors.notFound('Listing');
      contextKey = `experience:${listing.id}:customer:${me.id}`;
      data = {
        contextType: 'EXPERIENCE',
        contextKey,
        experience: { connect: { id: listing.id } },
      };
      participants = [
        { userId: me.id, role: 'CUSTOMER' },
        { userId: listing.agentProfile.userId, role: 'AGENT' },
      ];
    } else if (input.contextType === 'SUPPORT') {
      // One support thread per person; HavenHub staff join it from the support queue.
      if (me.accountType !== AccountType.CUSTOMER && me.accountType !== AccountType.AGENT) {
        throw Errors.forbidden('Support conversations are for customers and agents.');
      }
      contextKey = `support:${me.id}`;
      data = { contextType: 'SUPPORT', contextKey };
      participants = [
        { userId: me.id, role: me.accountType === AccountType.AGENT ? 'AGENT' : 'CUSTOMER' },
      ];
    } else {
      const booking = await this.prisma.booking.findUnique({
        where: { id: input.bookingId },
        select: { id: true, customerId: true, agentProfile: { select: { userId: true } } },
      });
      if (!booking || (booking.customerId !== me.id && booking.agentProfile.userId !== me.id)) {
        throw Errors.notFound('Booking');
      }
      contextKey = `booking:${booking.id}`;
      data = { contextType: 'BOOKING', contextKey, booking: { connect: { id: booking.id } } };
      participants = [
        { userId: booking.customerId, role: 'CUSTOMER' },
        { userId: booking.agentProfile.userId, role: 'AGENT' },
      ];
    }

    let created = false;
    let row = await this.prisma.conversation.findUnique({ where: { contextKey } });
    // Support stays reachable when new conversations are turned off.
    if (
      !row &&
      input.contextType !== 'SUPPORT' &&
      !(await this.policies.get()).chat.newConversations
    ) {
      throw Errors.featureDisabled('Starting new conversations is turned off right now.');
    }
    if (!row) {
      try {
        row = await this.prisma.conversation.create({
          data: { ...data, participants: { create: participants } },
        });
        created = true;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
          throw error;
        }
        row = await this.prisma.conversation.findUniqueOrThrow({ where: { contextKey } });
      }
    }
    if (created) await this.events.conversation(ChatEvent.CONVERSATION_CREATED, row.id);
    return this.get(me.id, row.id);
  }

  async list(userId: string, query: ListQuery): Promise<ConversationPage> {
    const cursor = decodeCursor(query.cursor);
    const search = query.search
      ? { contains: query.search, mode: 'insensitive' as const }
      : undefined;
    const where: Prisma.ConversationWhereInput = {
      participants: {
        some: { userId, archivedAt: query.archived ? { not: null } : null },
      },
      ...(cursor
        ? {
            OR: [
              { lastActivityAt: { lt: cursor.at } },
              { lastActivityAt: cursor.at, id: { lt: cursor.id } },
            ],
          }
        : {}),
      ...(search
        ? {
            AND: [
              {
                OR: [
                  { property: { title: search } },
                  { experience: { title: search } },
                  { booking: { reference: search } },
                  { booking: { property: { title: search } } },
                  {
                    participants: {
                      some: {
                        userId: { not: userId },
                        user: {
                          OR: [{ fullName: search }, { agentProfile: { businessName: search } }],
                        },
                      },
                    },
                  },
                ],
              },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.conversation.findMany({
      where,
      orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: CONVERSATION_INCLUDE,
    });
    const page = rows.slice(0, query.limit);
    const unread = await this.unread.forConversations(
      userId,
      page.map((r) => r.id),
    );
    const last = page.at(-1);
    return {
      items: page.map((r) => toConversationSummary(r, userId, unread.get(r.id) ?? 0, this.storage)),
      nextCursor:
        rows.length > query.limit && last ? encodeCursor(last.lastActivityAt, last.id) : null,
    };
  }

  async get(userId: string, conversationId: string): Promise<ConversationSummary> {
    await this.access.participant(conversationId, userId);
    const row = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: CONVERSATION_INCLUDE,
    });
    const unread = await this.unread.forConversations(userId, [conversationId]);
    return toConversationSummary(row, userId, unread.get(conversationId) ?? 0, this.storage);
  }

  /** Archiving is personal: it hides the conversation from your list only. */
  async archive(userId: string, conversationId: string, archived: boolean) {
    await this.access.participant(conversationId, userId);
    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { archivedAt: archived ? new Date() : null },
    });
    return this.get(userId, conversationId);
  }

  /**
   * Moves the reader's cursor forward to `seq` (clamped to the newest
   * message). Monotonic in SQL, so concurrent or out-of-order calls can
   * never move it backwards.
   */
  async markRead(userId: string, conversationId: string, seq: number) {
    const before = await this.access.participant(conversationId, userId);
    const [row] = await this.prisma.$queryRaw<{ last_read_seq: number }[]>`
      UPDATE conversation_participants p
      SET last_read_seq = GREATEST(p.last_read_seq, LEAST(${seq}::int, c.last_seq)),
          last_read_at = now()
      FROM conversations c
      WHERE c.id = p.conversation_id
        AND p.conversation_id = ${conversationId}::uuid
        AND p.user_id = ${userId}::uuid
      RETURNING p.last_read_seq`;
    if (!row) throw Errors.notFound('Conversation');
    if (row.last_read_seq > before.lastReadSeq) {
      await this.events.read(conversationId, userId, row.last_read_seq);
    }
    await this.notifications.read(userId, conversationId);
    const unread = await this.unread.forConversations(userId, [conversationId]);
    return { lastReadSeq: row.last_read_seq, unreadCount: unread.get(conversationId) ?? 0 };
  }

  unreadSummary(userId: string) {
    return this.unread.summary(userId);
  }

  /** Closed conversations stay readable but accept no new messages. */
  assertOpen(status: string) {
    if (status !== 'OPEN') {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONVERSATION_CLOSED,
        'This conversation has been closed by HavenHub support.',
      );
    }
  }
}

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const at = new Date(iso ?? '');
  if (Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/.test(id ?? '')) {
    throw Errors.badRequest('Invalid cursor.');
  }
  return { at, id: id! };
}
