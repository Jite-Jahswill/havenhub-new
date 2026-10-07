import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ChatEvent, type ChatEventPayloads } from '@havenhub/shared';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  CONVERSATION_INCLUDE,
  MESSAGE_INCLUDE,
  toConversationSummary,
  toMessageView,
  toReactions,
} from './chat.mapper';
import { ChatAccessService } from './chat-access.service';
import { UnreadService } from './unread.service';
import { PlatformPoliciesService } from '../platform/platform-policies.service';

/**
 * Publishes chat events to every participant's own room, each with a view
 * built for that recipient (e.g. `mine` on reactions, own `clientKey`).
 * Called after the change has committed; a delivery failure is logged and
 * never affects the stored state (clients re-sync over REST).
 */
@Injectable()
export class ChatEventsService {
  private readonly logger = new Logger(ChatEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly access: ChatAccessService,
    private readonly unread: UnreadService,
    private readonly storage: StorageService,
    private readonly policies: PlatformPoliciesService,
  ) {}

  private send<E extends keyof ChatEventPayloads>(
    userId: string,
    event: E,
    payload: ChatEventPayloads[E],
  ) {
    this.realtime.emitToUser(userId, event, payload);
  }

  private async guarded(label: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (error) {
      this.logger.error(`Could not publish ${label}: ${(error as Error).message}`);
    }
  }

  messageChanged(
    event:
      | typeof ChatEvent.MESSAGE_CREATED
      | typeof ChatEvent.MESSAGE_UPDATED
      | typeof ChatEvent.MESSAGE_DELETED,
    messageId: string,
  ) {
    return this.guarded(event, async () => {
      const message = await this.prisma.message.findUniqueOrThrow({
        where: { id: messageId },
        include: MESSAGE_INCLUDE,
      });
      const eventId = randomUUID();
      const { editWindowMinutes } = (await this.policies.get()).chat;
      for (const userId of await this.access.participantIds(message.conversationId)) {
        this.send(userId, event, {
          eventId,
          conversationId: message.conversationId,
          message: toMessageView(message, userId, this.storage, editWindowMinutes),
        });
      }
    });
  }

  reactionsChanged(messageId: string) {
    return this.guarded(ChatEvent.MESSAGE_REACTION_UPDATED, async () => {
      const message = await this.prisma.message.findUniqueOrThrow({
        where: { id: messageId },
        select: { conversationId: true, reactions: { select: { emoji: true, userId: true } } },
      });
      const eventId = randomUUID();
      for (const userId of await this.access.participantIds(message.conversationId)) {
        this.send(userId, ChatEvent.MESSAGE_REACTION_UPDATED, {
          eventId,
          conversationId: message.conversationId,
          messageId,
          reactions: toReactions(message.reactions, userId),
        });
      }
    });
  }

  read(conversationId: string, userId: string, lastReadSeq: number) {
    return this.guarded(ChatEvent.MESSAGE_READ, async () => {
      const eventId = randomUUID();
      for (const recipient of await this.access.participantIds(conversationId)) {
        this.send(recipient, ChatEvent.MESSAGE_READ, {
          eventId,
          conversationId,
          userId,
          lastReadSeq,
        });
      }
    });
  }

  conversation(
    event: typeof ChatEvent.CONVERSATION_CREATED | typeof ChatEvent.CONVERSATION_UPDATED,
    conversationId: string,
  ) {
    return this.guarded(event, async () => {
      const row = await this.prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
        include: CONVERSATION_INCLUDE,
      });
      const eventId = randomUUID();
      for (const p of row.participants) {
        const unread = await this.unread.forConversations(p.userId, [conversationId]);
        this.send(p.userId, event, {
          eventId,
          conversationId,
          conversation: toConversationSummary(
            row,
            p.userId,
            unread.get(conversationId) ?? 0,
            this.storage,
          ),
        });
      }
    });
  }

  typing(
    event: typeof ChatEvent.TYPING_STARTED | typeof ChatEvent.TYPING_STOPPED,
    conversationId: string,
    userId: string,
    recipients: string[],
  ) {
    const eventId = randomUUID();
    for (const recipient of recipients) {
      if (recipient !== userId) this.send(recipient, event, { eventId, conversationId, userId });
    }
  }
}
