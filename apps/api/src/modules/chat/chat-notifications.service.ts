import { Inject, Injectable, Logger } from '@nestjs/common';

import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { MailService } from '../../infrastructure/mail/mail.service';
import { MailTemplates } from '../../infrastructure/mail/mail.templates';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { chatDisplayName } from './chat.mapper';

const DUE_KEY = 'chat:digest:due';

/**
 * A notification channel for chat activity. Real-time (in-app) delivery is
 * handled by ChatEventsService; email digests are below; a push channel for
 * the mobile app plugs in here later by implementing the same hooks.
 */
export interface ChatNotificationChannel {
  /** A message was sent by `senderId`; every other participant is a recipient. */
  messageCreated(conversationId: string, messageId: string, senderId: string): Promise<void>;
  read(userId: string, conversationId: string): Promise<void>;
}

/**
 * Chat notifications without spam:
 * - every message reaches online participants instantly over the socket;
 * - email is a digest: when someone has unread messages in a conversation for
 *   CHAT_EMAIL_DELAY_SECONDS, they get one email (count + sender, no message
 *   content), and no other until they read the conversation and fall behind
 *   again. Rapid-fire messages therefore produce at most one email.
 * - reactions are real-time only (never emailed).
 *
 * The schedule lives in a Redis sorted set; the sweep claims each entry with
 * ZREM, so concurrent instances never send the same digest twice.
 */
@Injectable()
export class ChatNotificationsService implements ChatNotificationChannel {
  private readonly logger = new Logger(ChatNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async messageCreated(conversationId: string, _messageId: string, senderId: string) {
    try {
      const recipients = await this.prisma.conversationParticipant.findMany({
        where: { conversationId, userId: { not: senderId } },
        select: { userId: true },
      });
      const due = Date.now() + this.env.CHAT_EMAIL_DELAY_SECONDS * 1000;
      for (const { userId } of recipients) {
        // NX: the first unread message of a burst sets the time; later ones don't push it back.
        await this.redis.client.zadd(DUE_KEY, 'NX', due, member(userId, conversationId));
      }
    } catch (error) {
      this.logger.warn(
        `Could not schedule chat email for ${conversationId}: ${(error as Error).message}`,
      );
    }
  }

  /** Reactions notify in real time only — never by email. */
  reactionAdded(_conversationId: string, _messageId: string, _userId: string): Promise<void> {
    return Promise.resolve();
  }

  async read(userId: string, conversationId: string) {
    await this.redis.client.zrem(DUE_KEY, member(userId, conversationId)).catch(() => undefined);
  }

  /** Sends digests that are due. Returns how many emails were sent. */
  async sendDue(now = Date.now()): Promise<number> {
    const due = await this.redis.client.zrangebyscore(DUE_KEY, 0, now, 'LIMIT', 0, 200);
    let sent = 0;
    for (const entry of due) {
      if ((await this.redis.client.zrem(DUE_KEY, entry)) !== 1) continue; // claimed elsewhere
      const [userId, conversationId] = entry.split(':');
      try {
        if (await this.sendDigest(userId!, conversationId!)) sent++;
      } catch (error) {
        this.logger.error(`Chat email for ${conversationId} failed: ${(error as Error).message}`);
      }
    }
    return sent;
  }

  private async sendDigest(userId: string, conversationId: string): Promise<boolean> {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      include: {
        user: { select: { email: true, fullName: true, accountType: true, status: true } },
        conversation: {
          select: {
            contextType: true,
            property: { select: { title: true } },
            booking: { select: { reference: true } },
            experience: { select: { title: true } },
          },
        },
      },
    });
    if (!participant || participant.user.status !== 'ACTIVE') return false;
    const from = Math.max(participant.lastReadSeq, participant.lastNotifiedSeq);
    const unread = await this.prisma.message.findMany({
      where: { conversationId, seq: { gt: from }, senderId: { not: userId }, deletedAt: null },
      orderBy: { seq: 'asc' },
      select: {
        seq: true,
        replyTo: { select: { senderId: true } },
        sender: { select: { fullName: true, agentProfile: { select: { businessName: true } } } },
      },
    });
    if (unread.length === 0) return false;
    const newest = unread.at(-1)!.seq;
    // Claim the range so a concurrent run cannot email the same messages.
    const { count } = await this.prisma.conversationParticipant.updateMany({
      where: { conversationId, userId, lastNotifiedSeq: participant.lastNotifiedSeq },
      data: { lastNotifiedSeq: newest },
    });
    if (count === 0) return false;
    const senders = [
      ...new Set(unread.map((m) => (m.sender ? chatDisplayName(m.sender) : 'HavenHub'))),
    ];
    const c = participant.conversation;
    const about =
      c.contextType === 'BOOKING' && c.booking
        ? `booking ${c.booking.reference}`
        : c.contextType === 'SUPPORT'
          ? 'your HavenHub support request'
          : `“${c.property?.title ?? c.experience?.title ?? 'a listing'}”`;
    const area =
      participant.user.accountType === 'AGENT'
        ? 'agent'
        : participant.user.accountType === 'ADMIN'
          ? 'admin'
          : 'account';
    await this.mail.send(
      MailTemplates.unreadMessages(
        participant.user.email,
        participant.user.fullName.split(' ')[0] || participant.user.fullName,
        senders.join(', '),
        unread.length,
        about,
        unread.some((m) => m.replyTo?.senderId === userId),
        `${this.env.WEB_APP_URL}/${area}/messages?c=${conversationId}`,
      ),
    );
    return true;
  }
}

const member = (userId: string, conversationId: string) => `${userId}:${conversationId}`;
